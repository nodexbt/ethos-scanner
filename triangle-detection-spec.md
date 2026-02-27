# Triangle Detection Algorithm Specification

## Goal

Detect coordinated review manipulation rings: cycles of three users (A→B→C→A) who each positively review the next person in a closed loop, artificially inflating scores.

## Required Data

A `reviews` table (or equivalent) with at minimum:
- `author_id` — who wrote the review
- `subject_id` — who the review is about
- `score` — review sentiment (positive = 2 in reference impl)
- `archived` — boolean, whether the review is soft-deleted

Author and subject must resolve to canonical profile/user IDs (the reference implementation joins through an `addresses` table to do this).

## Algorithm

### Step 1: Filter to Active Reviews

Select reviews where:
- `archived = false`
- `score = 2` (positive only — configurable, but recommended)
- `author_id != subject_id` (no self-reviews)

### Step 2: Find All A→B→C→A Cycles

Three-way self-join on the filtered reviews:

```
r1: A → B
r2: B → C   (join on r1.subject_id = r2.author_id)
r3: C → A   (join on r2.subject_id = r3.author_id AND r3.subject_id = r1.author_id)
```

### Step 3: Deduplicate

Each triangle {A, B, C} can be discovered 3 times (starting from A, B, or C). Enforce a canonical ordering to count each triangle exactly once:

```
WHERE r1.author_id < r2.author_id
  AND r2.author_id < r3.author_id
```

### Step 4: Exclude Mutual Reviews (Critical)

For each pair in the triangle, check if a review exists in the opposite direction. If ANY pair has mutual reviews, exclude the entire triangle:

```
AND NOT EXISTS (reverse review from B → A)
AND NOT EXISTS (reverse review from C → B)
AND NOT EXISTS (reverse review from A → C)
```

**Why:** Mutual reviews indicate a legitimate bidirectional relationship, not one-way coordinated manipulation. This is the key filter that separates real community interaction from gaming.

## Reference SQL (PostgreSQL)

```sql
WITH active_reviews AS (
  SELECT
    author_id,
    subject_id,
    score,
    created_at
  FROM reviews
  WHERE archived = false
    AND score = 2
    AND author_id != subject_id
),

all_triangles AS (
  SELECT DISTINCT
    r1.author_id  AS profile_a,
    r1.subject_id AS profile_b,
    r2.subject_id AS profile_c,
    r1.score AS score_a_to_b,
    r2.score AS score_b_to_c,
    r3.score AS score_c_to_a,
    r1.created_at AS review_a_date,
    r2.created_at AS review_b_date,
    r3.created_at AS review_c_date
  FROM active_reviews r1
  JOIN active_reviews r2
    ON r1.subject_id = r2.author_id
  JOIN active_reviews r3
    ON r2.subject_id = r3.author_id
    AND r3.subject_id = r1.author_id
  WHERE
    -- Deduplication: count each triangle once
    r1.author_id < r2.author_id
    AND r2.author_id < r3.author_id
    -- Exclude triangles where any pair has mutual reviews
    AND NOT EXISTS (
      SELECT 1 FROM active_reviews m
      WHERE m.author_id = r1.subject_id AND m.subject_id = r1.author_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM active_reviews m
      WHERE m.author_id = r2.subject_id AND m.subject_id = r2.author_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM active_reviews m
      WHERE m.author_id = r3.subject_id AND m.subject_id = r3.author_id
    )
)

SELECT * FROM all_triangles;
```

## Post-Detection Analysis (Optional)

Once triangles are detected, useful metrics to compute per profile:

- **Triangle count**: how many triangles a profile appears in
- **Unique connections**: how many distinct people they share triangles with
- **Severity tiers**: Extreme (≥100), Heavy (50–99), Moderate (10–49), Light (1–9)
- **Time span**: duration between earliest and latest review in each triangle
- **Score distribution**: group offenders by their platform score to see if high-score users are gaming

## Adapting to Your Schema

You will need to adjust:
1. **Table/column names** to match your schema
2. **ID resolution** — if users can have multiple addresses/identifiers, join through a mapping table to get canonical IDs
3. **Score values** — map to whatever your review scoring system uses for "positive"
4. **Additional enrichment** — join usernames, social handles, financial data (vouches/stakes) for reporting
