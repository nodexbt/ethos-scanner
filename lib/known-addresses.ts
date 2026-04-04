// Known exchange and infrastructure addresses
// Source: Etherscan labels, public documentation
// All addresses must be lowercase

const KNOWN_ADDRESSES: Record<string, string> = {
  // Kraken
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0": "Kraken",
  "0xae2d4617c862309a3d75a0ffb358c7a5009c673f": "Kraken",
  "0x53d284357ec70ce289d6d64134dfac8e511c8a3d": "Kraken",
  "0x89e51fa8ca5d66cd220baed62ed01e8951aa7c40": "Kraken",
  "0xc6bed363b30df7f35b601a5547fe56cd31ec63da": "Kraken",
  "0x29728d0efd284d36f2d0cd86b1b8e17f1f9e5860": "Kraken",
  "0xe853c56864a2ebe4576a807d26fdc4a0ada51919": "Kraken",
  "0xda9dfa130df4de4673b89022ee50ff26f6ea73cf": "Kraken",
  "0xa83b11093c858c86321fbc4c20fe82cdbd58e09e": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0xe0a7aE288C3bf6A5896aea2143e776b482D3407F": "Kraken",

  // Binance
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be": "Binance",
  "0xd551234ae421e3bcba99a0da6d736074f22192ff": "Binance",
  "0x564286362092d8e7936f0549571a803b203aaced": "Binance",
  "0x0681d8db095565fe8a346fa0277bffde9c0edbbf": "Binance",
  "0xfe9e8709d3215310075d67e3ed32a380ccf451c8": "Binance",
  "0x4e9ce36e442e55ecd9025b9a6e0d88485d628a67": "Binance",
  "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0x8894e0a0c962cb723c1ef8a1b728b5ae42c4bbb2": "Binance",
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": "Binance",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Binance",
  "0xab83d182f3485cf1d6ccdd34c7cfef95b4c08da4": "Binance",
  "0x4fabb145d64652a948d72533023f6e7a623c7c53": "Binance",

  // Coinbase
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x3cd751e6b0078be393132286c442345e68ff0aaa": "Coinbase",
  "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511": "Coinbase",
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x77134cbc06cb00b66f4c7e623d5fdbf6777635ec": "Coinbase",
  "0xe93381fb4c4f14bda253907b18fad305d799241a": "Coinbase",

  // OKX
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
  "0xa7efae728d2936e78bda97dc267687568dd593f3": "OKX",

  // Bybit
  "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4": "Bybit",

  // KuCoin
  "0xd6216fc19db775df9774a6e33526131da7d19a2c": "KuCoin",
  "0xf16e9b0d03470827a95cdfd0cb8a8a3b46969b91": "KuCoin",

  // Gate.io
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
  "0x7793cd85c11a924478d358d49b05b37e91b5810f": "Gate.io",

  // Huobi / HTX
  "0xab5c66752a9e8167967685f1450532fb96d5d24f": "HTX",
  "0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b": "HTX",
  "0xfdb16996831753d5331ff813c29a93c76834a0ad": "HTX",
  "0xeee27662c2b8eba3cd936a23f039f3189633e4c8": "HTX",

  // Gemini
  "0xd24400ae8bfebb18ca49be86258a3c749cf46853": "Gemini",
  "0x6fc82a5fe25a5cdb58bc74600a40a69c065263f8": "Gemini",
  "0x61edcdf5bb737adffe5043706e7c5bb1f1a56eea": "Gemini",

  // Bitfinex
  "0x876eabf441b2ee5b5b0554fd502a8e0600950cfa": "Bitfinex",
  "0x742d35cc6634c0532925a3b844bc9e7595f2bd1e": "Bitfinex",
  "0x1151314c646ce4e0efd76d1af4760ae66a9fe30f": "Bitfinex",

  // Crypto.com
  "0x6262998ced04146fa42253a5c0af90ca02dfd2a3": "Crypto.com",
  "0x46340b20830761efd32832a74d7169b29feb9758": "Crypto.com",

  // Common bridges
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x3e2ea9b92b7e48a52296fd261dc26fd995284631": "Optimism Bridge",
  "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1": "Optimism Bridge",
  "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a": "Arbitrum Bridge",
  "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f": "Arbitrum Bridge",
  "0xa3a7b6f88361f48403514059f1f16c8e78d60eec": "Arbitrum Bridge",

  // LayerZero / Stargate
  "0x296f55f8fb28e498b858d0bcda06d955b2cb3f97": "Stargate",
  "0x8731d54e9d02c286767d56ac03e8037c07e01e98": "Stargate",

  // Across Bridge
  "0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5": "Across Bridge",
};

// Normalize all keys to lowercase
const normalizedAddresses = new Map<string, string>();
for (const [addr, label] of Object.entries(KNOWN_ADDRESSES)) {
  normalizedAddresses.set(addr.toLowerCase(), label);
}

export function getAddressLabel(address: string): string | null {
  return normalizedAddresses.get(address.toLowerCase()) || null;
}

export function isExchangeAddress(address: string): boolean {
  const label = getAddressLabel(address);
  if (!label) return false;
  // Bridges are infrastructure, not exchanges
  return !label.includes("Bridge") && !label.includes("Stargate") && !label.includes("Across");
}
