import {
  AccessRequestListItemResponse,
  CreateAccessRequestRequest as ApiCreateAccessRequestRequest,
  UpdateAccessRequestRequest as ApiUpdateAccessRequestRequest,
} from './iam-contract.model';

/**
 * One row of the access-request queue.
 *
 * An alias of the generated contract rather than a copy — see the note on `UserListItem` for
 * why every one of these is an alias now.
 */
export type AccessRequestItemApi = AccessRequestListItemResponse;

/** Raising a request. An alias of the generated contract. */
export type CreateAccessRequestRequest = ApiCreateAccessRequestRequest;

/**
 * Editing a draft or a request that was sent back. An alias of the generated contract.
 *
 * THE HAND-WRITTEN SHAPE THAT USED TO BE HERE did not match the server: it carried a review date,
 * a supporting document and an approver the API has never read. It is gone, and so is the
 * "list response" that bundled four option lists this screen invented - those come from
 * `/reference-data/enums` now.
 */
export type UpdateAccessRequestRequest = ApiUpdateAccessRequestRequest;
