import {
  CreateRoleRequest as ApiCreateRoleRequest,
  UpdateRoleRequest as ApiUpdateRoleRequest,
  RoleClaimResponse,
  RoleDetailResponse,
  RoleIncompatibilityResponse,
  RoleListItemResponse,
  RolePermissionResponse,
} from './iam-contract.model';
import { ApiEnumOption } from './enum-option.model';

/** One row of the role catalogue. An alias of the generated contract. */
export type RoleListItem = RoleListItemResponse;

/** The full role record. An alias of the generated contract. */
export type RoleDetail = RoleDetailResponse;

/** One permission inside a role. An alias of the generated contract. */
export type RolePermission = RolePermissionResponse;

/** One claim inside a role. An alias of the generated contract. */
export type RoleClaim = RoleClaimResponse;

/** One segregation-of-duties rule. An alias of the generated contract. */
export type RoleIncompatibility = RoleIncompatibilityResponse;

/** Creating a role. An alias of the generated contract. */
export type CreateRoleRequest = ApiCreateRoleRequest;

/** Updating a role. An alias of the generated contract. */
export type UpdateRoleRequest = ApiUpdateRoleRequest;

/**
 * The catalogue as the screen works from it: the rows, and the vocabularies its filters and
 * its permission matrix are drawn from.
 *
 * EVERY WORD COMES FROM THE SERVER. The rows are `GET /roles`; the three option lists are
 * `GET /reference-data/enums`. They used to be literal lists in the service, which is how the
 * filter came to offer "In use" for a state every row called "Active".
 */
export interface RoleCatalogueResponse {
  roles: RoleListItem[];
  totalCount: number;
  /** The role states, in the server's order and words. */
  statusOptions: ApiEnumOption[];
  /** The role types, in the server's words. */
  roleTypeOptions: ApiEnumOption[];
  /** The verbs a permission can carry, in the server's order: the columns of the matrix. */
  permissionActions: ApiEnumOption[];
}

/** Query string for the role catalogue and its export. Mirrors the API's parameters exactly. */
export interface RoleSearchFilter {
  /** Matches the role name, code or purpose. */
  search?: string;
  status?: string;
  roleType?: string;
  isSystemRole?: boolean;
  isPrivileged?: boolean;
  /** Roles that allow this permission. */
  permissionCode?: string;
  /** The owning function, matched whole. */
  displayTag?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}
