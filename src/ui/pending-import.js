// A one-shot handover between the scan screen and the import preview.
//
// The scanned text is far too big for a URL, and writing it to storage would
// mean a half-finished import surviving a crash and reappearing later, which
// is worse than losing it. So it lives in memory for exactly one navigation.

let pending = null;

export const setPendingImport = (value) => {
  pending = value;
};

export function takePendingImport() {
  const value = pending;
  pending = null;
  return value;
}
