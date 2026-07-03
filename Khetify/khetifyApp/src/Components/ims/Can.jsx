import React from "react";
import { usePermission } from "../../context/PermissionContext";

/**
 * Renders children only when the current role holds `capability`.
 *
 *   <Can capability="adjustment:approve">
 *     <PrimaryBtn onClick={approve}>Approve</PrimaryBtn>
 *   </Can>
 *
 * Optional `fallback` renders when denied (default: nothing). UI gating only —
 * the backend authorize() is the real enforcement point.
 */
const Can = ({ capability, fallback = null, children }) => {
  const allowed = usePermission(capability);
  return allowed ? <>{children}</> : fallback;
};

export default Can;
