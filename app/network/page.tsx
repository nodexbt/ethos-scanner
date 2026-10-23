import { redirect } from "next/navigation";

// The network view lives in the main app as a tab; keep the old URL working.
export default function NetworkRedirect() {
  redirect("/?tab=network");
}
