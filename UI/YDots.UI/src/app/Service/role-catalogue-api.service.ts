import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { EnumOptionsService } from '../Shared/services/enum-options.service';
import { fetchAllPages } from '../Shared/services/paging';
import {
  ApiResponse,
  OutcomeResponse,
  PagedResponse,
} from '../Shared/models/api-response.model';
import { toApiEnumOptions } from '../Shared/models/enum-option.model';
import { RoleCatalogueResponse, RoleSearchFilter } from '../Shared/models/role-catalogue-api.model';
import {
  AssignRoleClaimsRequest,
  AssignRolePermissionsRequest,
  ChangeRoleStatusRequest,
  CreateRoleIncompatibilityRequest,
  CreateRoleRequest,
  DeleteRoleRequest,
  PermissionMatrixResponse,
  RoleDetailResponse,
  RoleIncompatibilityResponse,
  RoleListItemResponse,
  RoleLookupResponse,
  RoleMemberResponse,
  UpdateRoleRequest,
} from '../Shared/models/iam-contract.model';

/** One permission in a comparison: the code that identifies it and the name a person reads. */
export interface ComparedPermission {
  code: string;
  name: string;
}

/** Two roles and the difference between what they allow. */
export interface RoleComparison {
  left: RoleDetailResponse;
  right: RoleDetailResponse;
  onlyInLeft: ComparedPermission[];
  onlyInRight: ComparedPermission[];
  inBoth: ComparedPermission[];
}

/** A role export as the browser receives it. */
export interface RoleExportFile {
  blob: Blob;
  /** The server's name for the file, which carries the time it was taken. */
  fileName: string;
  /** The reference the audit trail records the export under. */
  reference: string;
}

/**
 * Roles and what they grant.
 *
 * ROLES ARE PER-ORGANISATION, so nothing here takes one as a parameter: the caller's token
 * decides. Two Organisations may both have a role coded ADMIN and neither can see the other's —
 * which is also why a role code is unique inside an Organisation and only inside it.
 *
 * PERMISSIONS ARE ASSIGNED AS A SET, NOT ONE AT A TIME. `assignPermissions` replaces the whole
 * list, which is what makes the screen's Save button mean what it appears to mean: what is ticked
 * is what the role ends up with. Adding and removing one at a time reads as simpler and produces
 * a role that is half-saved when somebody closes the tab.
 *
 * A PLATFORM-ONLY CODE IS REFUSED, not silently dropped. An administrator who was quietly given
 * less than they asked for would believe they had granted something they had not.
 */
@Injectable({ providedIn: 'root' })
export class RoleCatalogueApiService {
  private readonly http = inject(HttpClient);
  private readonly enums = inject(EnumOptionsService);
  private readonly baseUrl = `${environment.apiBaseUrl}/roles`;
  private readonly permissionsUrl = `${environment.apiBaseUrl}/permissions`;

  // =========================================================================================
  // Reading
  // =========================================================================================

  search(filter: RoleSearchFilter): Observable<PagedResponse<RoleListItemResponse>> {
    return this.http
      .get<ApiResponse<PagedResponse<RoleListItemResponse>>>(this.baseUrl, {
        params: this.toParams(filter),
      })
      .pipe(map((response) => response.data!));
  }

  getRole(id: string): Observable<RoleDetailResponse> {
    return this.http
      .get<ApiResponse<RoleDetailResponse>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data!));
  }

  /** The roles that can be assigned, for a dropdown. Platform roles are excluded by the server. */
  getRoleLookup(): Observable<RoleLookupResponse[]> {
    return this.http
      .get<ApiResponse<RoleLookupResponse[]>>(`${this.baseUrl}/lookup`)
      .pipe(map((response) => response.data ?? []));
  }

  /** Who holds this role. Paged, because a default role holds everybody. */
  getMembers(id: string, page = 1, pageSize = 20): Observable<PagedResponse<RoleMemberResponse>> {
    return this.http
      .get<ApiResponse<PagedResponse<RoleMemberResponse>>>(`${this.baseUrl}/${id}/members`, {
        params: new HttpParams().set('page', page).set('pageSize', pageSize),
      })
      .pipe(map((response) => response.data!));
  }

  /**
   * The permission matrix, optionally showing what one role already holds.
   *
   * Grouped by module and group: a flat list of a hundred and thirty codes cannot be reasoned
   * about, and the point of the editor is to let somebody decide what a role should do.
   */
  getPermissionMatrix(roleId?: string): Observable<PermissionMatrixResponse> {
    return this.http
      .get<ApiResponse<PermissionMatrixResponse>>(`${this.permissionsUrl}/matrix`, {
        params: roleId ? new HttpParams().set('roleId', roleId) : undefined,
      })
      .pipe(map((response) => response.data!));
  }

  /**
   * Exports the catalogue to CSV: the roles the filter selects, built by the server.
   *
   * THE SAME FILTER THE TABLE SENT, so the file holds the rows on screen. The server names the
   * file and audits the export under the reference it returns.
   */
  export(filter: RoleSearchFilter): Observable<RoleExportFile> {
    return this.http
      .get(`${this.baseUrl}/export`, {
        params: this.toParams({ ...filter, page: undefined, pageSize: undefined }),
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(map((response) => {
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);

        return {
          blob: response.body ?? new Blob(),
          fileName: match ? decodeURIComponent(match[1]) : 'roles.csv',
          reference: response.headers.get('X-Export-Reference') ?? '',
        };
      }));
  }

  // =========================================================================================
  // Writing
  // =========================================================================================

  createRole(request: CreateRoleRequest): Observable<RoleDetailResponse> {
    return this.http
      .post<ApiResponse<RoleDetailResponse>>(this.baseUrl, request)
      .pipe(map((response) => response.data!));
  }

  updateRole(id: string, request: UpdateRoleRequest): Observable<OutcomeResponse> {
    return this.http
      .put<ApiResponse<OutcomeResponse>>(`${this.baseUrl}/${id}`, request)
      .pipe(map((response) => response.data!));
  }

  /**
   * Replaces the role's permission set.
   *
   * `deniedPermissionCodes` is the explicit-deny list, and deny beats allow: a code that appears
   * in both is denied. That is what makes it possible to give somebody a broad role and carve
   * one thing out of it, rather than building a near-duplicate role.
   */
  assignPermissions(id: string, request: AssignRolePermissionsRequest): Observable<OutcomeResponse> {
    return this.http
      .put<ApiResponse<OutcomeResponse>>(`${this.baseUrl}/${id}/permissions`, request)
      .pipe(map((response) => response.data!));
  }

  assignClaims(id: string, request: AssignRoleClaimsRequest): Observable<OutcomeResponse> {
    return this.http
      .put<ApiResponse<OutcomeResponse>>(`${this.baseUrl}/${id}/claims`, request)
      .pipe(map((response) => response.data!));
  }

  changeStatus(id: string, request: ChangeRoleStatusRequest): Observable<OutcomeResponse> {
    return this.http
      .post<ApiResponse<OutcomeResponse>>(`${this.baseUrl}/${id}/status`, request)
      .pipe(map((response) => response.data!));
  }

  /**
   * Deletes a role.
   *
   * Refused while anybody holds it, and refused outright for a system role. Deactivating is what
   * to use for a role with history attached — it disappears from the pickers and leaves every
   * past assignment intact and explicable.
   */
  deleteRole(id: string, request: DeleteRoleRequest): Observable<OutcomeResponse> {
    return this.http
      .delete<ApiResponse<OutcomeResponse>>(`${this.baseUrl}/${id}`, { body: request })
      .pipe(map((response) => response.data!));
  }

  // =========================================================================================
  // Segregation of duties
  // =========================================================================================

  /**
   * Records that two roles must not be held together.
   *
   * The classic case is raising a payment and approving one. `isBlocking` decides whether the
   * combination is refused outright or merely flagged for somebody to justify — both are useful,
   * and which applies is a policy decision rather than a technical one.
   */
  addIncompatibility(request: CreateRoleIncompatibilityRequest):
    Observable<RoleIncompatibilityResponse> {
    return this.http
      .post<ApiResponse<RoleIncompatibilityResponse>>(`${this.baseUrl}/incompatibilities`, request)
      .pipe(map((response) => response.data!));
  }

  removeIncompatibility(incompatibilityId: string): Observable<OutcomeResponse> {
    return this.http
      .delete<ApiResponse<OutcomeResponse>>(`${this.baseUrl}/incompatibilities/${incompatibilityId}`)
      .pipe(map((response) => response.data!));
  }

  // ---- The catalogue as the role screen reads it ----------------------------------------------

  /**
   * Every role the filter selects - all of its pages.
   *
   * THE SERVER DOES THE FILTERING. The screen sends what its tabs, search box and filter panel
   * hold and prints what comes back, so the table, the export and anybody calling the API with
   * the same parameters see the same roles. The API caps a page at 100 rows, hence the paging.
   */
  searchAll(filter: RoleSearchFilter = {}): Observable<RoleListItemResponse[]> {
    return fetchAllPages((page, pageSize) => this.search({ ...filter, page, pageSize }));
  }

  /**
   * The whole catalogue plus the vocabularies the screen is drawn from.
   *
   * THE VOCABULARIES ARE THE SERVER'S (`/reference-data/enums`): the role states and types the
   * filters offer, and the permission verbs the matrix has columns for. They were literal lists
   * here - three states called Draft, In use and Retired while every row said Active or
   * Inactive - and a value added on the server could never have been filtered for.
   */
  getCatalogue(): Observable<RoleCatalogueResponse> {
    return forkJoin({
      roles: this.searchAll(),
      enums: this.enums.getAll(),
    }).pipe(
      map(({ roles, enums }) => ({
        roles,
        totalCount: roles.length,
        statusOptions: toApiEnumOptions(enums.roleStatuses),
        roleTypeOptions: toApiEnumOptions(enums.roleTypes),
        permissionActions: toApiEnumOptions(enums.permissionActions),
      })),
    );
  }

  /**
   * Compares two roles' permissions.
   *
   * Done here rather than server-side because it is set arithmetic over two records the client
   * can already read, and an endpoint for it would be a round trip to compute something both
   * sides already have. Fetching both and diffing is one call fewer and one contract fewer.
   */
  compareRoles(leftRoleId: string, rightRoleId: string): Observable<RoleComparison> {
    return forkJoin({
      left: this.getRole(leftRoleId),
      right: this.getRole(rightRoleId),
    }).pipe(
      map(({ left, right }) => {
        // What each role ALLOWS, by code, with the name the server gives the permission.
        const allowedBy = (role: RoleDetailResponse) =>
          new Map((role.permissions ?? [])
            .filter((permission) => permission.isDenied !== true && !!permission.permissionCode)
            .map((permission): [string, string] => [
              permission.permissionCode!,
              permission.permissionName ?? permission.permissionCode!,
            ]));

        const leftAllowed = allowedBy(left);
        const rightAllowed = allowedBy(right);

        const pick = (from: Map<string, string>, keep: (code: string) => boolean): ComparedPermission[] =>
          [...from.entries()]
            .filter(([code]) => keep(code))
            .map(([code, name]) => ({ code, name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
          left,
          right,
          onlyInLeft: pick(leftAllowed, (code) => !rightAllowed.has(code)),
          onlyInRight: pick(rightAllowed, (code) => !leftAllowed.has(code)),
          inBoth: pick(leftAllowed, (code) => rightAllowed.has(code)),
        };
      }),
    );
  }

  /**
   * Activating a role.
   *
   * There is no separate approval workflow for a role: a role IS its permissions, and the
   * approval that matters is the one on the permissions themselves. Draft and active are the
   * two states that mean anything — draft is being built, active is in use.
   *
   * THE REASON IS THE ADMINISTRATOR'S. It defaulted to a sentence written here, which is what
   * the audit trail then recorded as the reason for every activation that did not give one.
   */
  activateRole = (id: string, expectedVersion: number, reason: string) =>
    this.changeStatus(id, { status: 'active', expectedVersion, reason });

  /**
   * Deactivating a role.
   *
   * Inactive rather than deleted, whenever anybody has ever held it: the assignment history has
   * to stay explicable, and a dangling role id in an audit row explains nothing.
   */
  deactivateRole = (id: string, expectedVersion: number, reason: string) =>
    this.changeStatus(id, { status: 'inactive', expectedVersion, reason });

  private toParams(filter: RoleSearchFilter): HttpParams {
    let params = new HttpParams();

    Object.entries(filter as Record<string, unknown>).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });

    return params;
  }
}
