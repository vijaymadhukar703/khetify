// User-facing terminology: internal warehouse-to-warehouse => "Transfer";
// anything involving an outside party (customer / seller / vendor / other company) => "Sales".
export function movementKind({ toType, type, refType } = {}) {
  if (toType) return toType === 'warehouse' ? 'Transfer' : 'Sales';
  if (type === 'transfer_in' || type === 'transfer_out') return 'Transfer';
  if (typeof type === 'string' && type.startsWith('sale')) return 'Sales';
  if (refType === 'Transfer' || refType === 'TransferRequest') return 'Transfer';
  if (refType === 'Order' || refType === 'SupplyOrder') return 'Sales';
  return refType || type || '';
}
