/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced from the IAM API's OpenAPI document by tools/generate-iam-contract.py.
// Every interface here mirrors a server DTO exactly, field for field, so a rename on
// the server becomes a compile error here instead of an empty cell on a screen.
//
// Regenerate with:  python tools/generate-iam-contract.py
// ---------------------------------------------------------------------------

// =========================================================================
// Enumerations
//
// String unions rather than TypeScript enums: the API serialises enums as
// camelCase names, so a union compares directly against what arrives on the
// wire with no conversion step to get wrong.
// =========================================================================

export type AccessRequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'returned';

export type AccessRequestType = 'roleAssignment' | 'permissionGrant' | 'dataScopeGrant' | 'temporaryElevation';

export type AccessReviewCampaignStatus = 'draft' | 'active' | 'closed' | 'cancelled';

export type AccessReviewDecision = 'retain' | 'modify' | 'revoke';

export type AccessReviewStatus = 'open' | 'inProgress' | 'completed' | 'overdue' | 'cancelled';

export type AccessScopeType = 'tenant' | 'global';

export type AuditResult = 'succeeded' | 'denied' | 'failed';

export type BulkActionType = 'invite' | 'activate' | 'suspend' | 'reactivate' | 'deactivate' | 'assignRole' | 'removeRole' | 'resetPassword' | 'forceSignOut' | 'requireMfaReset' | 'extendAccess' | 'export';

export type BulkOperationStatus = 'draft' | 'validating' | 'validated' | 'queued' | 'running' | 'completed' | 'partiallySucceeded' | 'failed' | 'cancelled';

export type BusinessUnitStatus = 'draft' | 'active' | 'suspended' | 'archived';

export type ClientType = 'unknown' | 'web' | 'mobile' | 'desktop' | 'api';

export type CredentialSetupMethod = 'invitationLink' | 'administratorSet' | 'temporaryPassword';

export type CurrencyType = 'fiat' | 'crypto' | 'other';

export type DataScopeType = 'organisation' | 'geography' | 'campaign' | 'warehouse' | 'queue' | 'assignment' | 'explicitRecord';

export type DocumentSubmissionDecision = 'approve' | 'reject' | 'requestReupload';

export type EngagementType = 'fullTime' | 'partTime' | 'contract' | 'volunteer' | 'intern' | 'external';

export type GeographicRegion = 'asia' | 'europe' | 'northAmerica' | 'southAmerica' | 'africa' | 'oceania' | 'middleEast' | 'antarctica';

export type InvitationType = 'tenantAdmin' | 'tenantUser' | 'donorPortal';

export type JurisdictionType = 'state' | 'unionTerritory' | 'province' | 'territory' | 'region' | 'district' | 'prefecture' | 'other';

export type LoginIdentifierChangeStatus = 'draft' | 'pendingVerification' | 'pendingApproval' | 'approved' | 'applied' | 'rejected' | 'cancelled' | 'expired';

export type MasterDataStatus = 'draft' | 'active' | 'inactive';

export type MasterRowScope = 'all' | 'platform' | 'tenant';

export type MenuLevel = 'menu' | 'subMenu' | 'childSubMenu';

export type MenuStatus = 'draft' | 'active' | 'hidden' | 'retired';

export type MfaMethodStatus = 'pending' | 'active' | 'revoked';

export type MfaMethodType = 'authenticatorApp' | 'sms' | 'email' | 'securityKey';

export type MfaRequirement = 'inherited' | 'required' | 'optional';

export type PaymentGatewayConfigurationAction = 'created' | 'updated' | 'activated' | 'deactivated' | 'deleted' | 'tested' | 'credentialsRotated';

export type PaymentGatewayEnvironment = 'sandbox' | 'production';

export type PaymentGatewayProvider = 'none' | 'razorpay' | 'stripe' | 'payPal' | 'payU' | 'cashfree' | 'hostedCheckout';

export type PermissionAction = 'view' | 'create' | 'edit' | 'submit' | 'approve' | 'operate' | 'export';

export type PermissionStatus = 'active' | 'retired';

export type PrivilegeLevel = 'standard' | 'elevated' | 'tenantAdmin' | 'superAdmin';

export type RecordStatus = 'draft' | 'active' | 'inactive' | 'archived';

export type RoleStatus = 'draft' | 'active' | 'inactive';

export type RoleType = 'tenant' | 'platform' | 'template';

export type RoundingMode = 'halfUp' | 'halfDown' | 'bankers';

export type SignInOutcome = 'succeeded' | 'invalidCredentials' | 'unknownAccount' | 'lockedOut' | 'suspended' | 'deactivated' | 'expired' | 'mfaRequired' | 'mfaFailed' | 'tenantInactive' | 'tenantNotResolved' | 'wrongTenant' | 'notActivated';

export type SignInResultStatus = 'succeeded' | 'mfaRequired' | 'tenantSelectionRequired' | 'passwordChangeRequired';

export type SymbolPosition = 'prefix' | 'suffix';

export type TenantDocumentStatus = 'uploaded' | 'underReview' | 'accepted' | 'rejected' | 'superseded';

export type TenantDocumentSubmissionStatus = 'draft' | 'submitted' | 'underReview' | 'approved' | 'rejected' | 'reuploadRequested';

export type TenantDocumentType = 'registrationCertificate' | 'taxExemptionCertificate' | 'panCard' | 'gstCertificate' | 'addressProof' | 'bankProof' | 'trustDeed' | 'annualReport' | 'authorisedSignatoryProof' | 'logo' | 'other';

export type TenantDomainType = 'subdomain' | 'customDomain' | 'alias';

export type TenantStatus = 'invited' | 'invitationAccepted' | 'profileIncomplete' | 'submitted' | 'underReview' | 'rejected' | 'resubmitted' | 'approved' | 'active' | 'suspended' | 'archived';

export type UserAccountCategory = 'employee' | 'volunteer' | 'partner' | 'auditor' | 'support' | 'donorPortal';

export type UserRoleAssignmentStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'expired';

export type UserStatus = 'draft' | 'invited' | 'active' | 'suspended' | 'deactivated' | 'expired' | 'withdrawn';

// =========================================================================
// Request and response bodies
// =========================================================================

export interface AcceptInvitationRequest {
  token?: string | null;
  password?: string | null;
  confirmPassword?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  mobileCountryCode?: string | null;
  mobileNumber?: string | null;
  acceptTerms?: boolean;
  clientType?: ClientType;
  deviceIdentifier?: string | null;
}

export interface AcceptInvitationResponse {
  succeeded?: boolean;
  accessToken?: string | null;
  accessTokenExpiresAtUtc?: string | null;
  expiresInSeconds?: number;
  refreshToken?: string | null;
  sessionId?: string | null;
  user?: AuthenticatedUserResponse;
  tenant?: TenantContextResponse;
  requiresOrganisationProfile?: boolean;
  requiresMfaEnrolment?: boolean;
  message?: string | null;
  recoveryCodes?: string[] | null;
  mfaEnrolled?: boolean;
  recoveryCodeNotice?: string | null;
}

export interface AcceptInvitationResponseApiResponse {
  success?: boolean;
  data?: AcceptInvitationResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccessRequestDetailResponse {
  id?: string;
  requestNumber?: string | null;
  requestedForUserId?: string;
  requestedForName?: string | null;
  requestedForEmail?: string | null;
  requestedByUserId?: string;
  requestedByName?: string | null;
  requestType?: AccessRequestType;
  requestTypeDisplay?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  permissionCode?: string | null;
  scopeType?: DataScopeType;
  scopeValue?: string | null;
  businessJustification?: string | null;
  accessStartsAtUtc?: string;
  accessEndsAtUtc?: string | null;
  status?: AccessRequestStatus;
  statusDisplay?: string | null;
  isSensitive?: boolean;
  submittedAtUtc?: string | null;
  decidedAtUtc?: string | null;
  decidedByUserId?: string | null;
  decidedByName?: string | null;
  decisionNotes?: string | null;
  withdrawnAtUtc?: string | null;
  withdrawalReason?: string | null;
  grantedUserRoleId?: string | null;
  createdAtUtc?: string;
  version?: number;
  permissionsGranted?: string[] | null;
  segregationOfDutiesConflicts?: string[] | null;
  canDecide?: boolean;
  permittedActions?: string[] | null;
}

export interface AccessRequestDetailResponseApiResponse {
  success?: boolean;
  data?: AccessRequestDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccessRequestListItemResponse {
  id?: string;
  requestNumber?: string | null;
  requestedForUserId?: string;
  requestedForName?: string | null;
  requestedByName?: string | null;
  requestType?: AccessRequestType;
  requestTypeDisplay?: string | null;
  roleName?: string | null;
  permissionCode?: string | null;
  status?: AccessRequestStatus;
  statusDisplay?: string | null;
  isSensitive?: boolean;
  submittedAtUtc?: string | null;
  accessStartsAtUtc?: string;
  accessEndsAtUtc?: string | null;
  decidedAtUtc?: string | null;
  decidedByName?: string | null;
  canDecide?: boolean;
  canCancel?: boolean;
  version?: number;
  scopeType?: DataScopeType;
  scopeValue?: string | null;
}

export interface AccessRequestListItemResponsePagedResponse {
  items?: AccessRequestListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface AccessRequestListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: AccessRequestListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccessReviewCampaignResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  status?: AccessReviewCampaignStatus;
  statusDisplay?: string | null;
  startsAtUtc?: string;
  dueAtUtc?: string;
  closedAtUtc?: string | null;
  closedByName?: string | null;
  totalReviewCount?: number;
  completedReviewCount?: number;
  overdueReviewCount?: number;
  percentComplete?: number;
  revokeOnNoResponse?: boolean;
  createdAtUtc?: string;
  version?: number;
  permittedActions?: string[] | null;
}

export interface AccessReviewCampaignResponseApiResponse {
  success?: boolean;
  data?: AccessReviewCampaignResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccessReviewCampaignResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: AccessReviewCampaignResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccessReviewDetailResponse {
  id?: string;
  reviewNumber?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  subjectUserId?: string;
  subjectName?: string | null;
  subjectEmail?: string | null;
  reviewerUserId?: string;
  reviewerName?: string | null;
  userRoleId?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  reviewDueAtUtc?: string;
  decision?: AccessReviewDecision;
  decisionReason?: string | null;
  decidedAtUtc?: string | null;
  status?: AccessReviewStatus;
  statusDisplay?: string | null;
  isOverdue?: boolean;
  isDecisionApplied?: boolean;
  decisionAppliedAtUtc?: string | null;
  reminderCount?: number;
  lastRemindedAtUtc?: string | null;
  version?: number;
  accessSnapshot?: string[] | null;
  permittedActions?: string[] | null;
}

export interface AccessReviewDetailResponseApiResponse {
  success?: boolean;
  data?: AccessReviewDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccessReviewListItemResponse {
  id?: string;
  reviewNumber?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  subjectUserId?: string;
  subjectName?: string | null;
  reviewerName?: string | null;
  roleName?: string | null;
  status?: AccessReviewStatus;
  statusDisplay?: string | null;
  decision?: AccessReviewDecision;
  reviewDueAtUtc?: string;
  isOverdue?: boolean;
  decidedAtUtc?: string | null;
  isDecisionApplied?: boolean;
  isAssignedToMe?: boolean;
  version?: number;
}

export interface AccessReviewListItemResponsePagedResponse {
  items?: AccessReviewListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface AccessReviewListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: AccessReviewListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AccountRecoveryGuidanceResponse {
  reason?: string | null;
  title?: string | null;
  message?: string | null;
  steps?: string[] | null;
  canSelfUnlock?: boolean;
  canRequestReset?: boolean;
  retryAfterUtc?: string | null;
  minutesRemaining?: number | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
}

export interface AccountRecoveryGuidanceResponseApiResponse {
  success?: boolean;
  data?: AccountRecoveryGuidanceResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AddOrganisationDomainRequest {
  hostName?: string | null;
  domainType?: TenantDomainType;
  isPrimary?: boolean;
}

export interface AdminResetPasswordRequest {
  expectedVersion?: number;
  sendResetLink?: boolean;
  temporaryPassword?: string | null;
  requireChangeOnNextSignIn?: boolean;
  signOutAllSessions?: boolean;
}

export interface ApiResponse {
  success?: boolean;
  data?: unknown | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface ApplyBulkOperationRequest {
  operationId?: string;
  expectedVersion?: number;
}

export interface ArchiveOrganisationRequest {
  reason?: string | null;
  expectedVersion?: number;
}

export interface AssignRoleClaimsRequest {
  claims?: RoleClaimRequest[] | null;
  expectedVersion?: number;
}

export interface AssignRolePermissionsRequest {
  permissionCodes?: string[] | null;
  expectedVersion?: number;
  deniedPermissionCodes?: string[] | null;
  justification?: string | null;
}

export interface AssignUserDataScopesRequest {
  dataScopes?: CreateUserDataScopeRequest[] | null;
  expectedVersion?: number;
  justification?: string | null;
}

export interface AssignUserRolesRequest {
  roleIds?: string[] | null;
  expectedVersion?: number;
  primaryRoleId?: string | null;
  justification?: string | null;
  effectiveToUtc?: string | null;
}

export interface AuditEventResponse {
  id?: string;
  tenantId?: string | null;
  tenantName?: string | null;
  businessUnitId?: string;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  actorScope?: AccessScopeType;
  actionCode?: string | null;
  actionDisplay?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetDisplayName?: string | null;
  result?: AuditResult;
  resultDisplay?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  occurredAtUtc?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  clientType?: ClientType;
  sessionId?: string | null;
  isSensitive?: boolean;
  requestPath?: string | null;
  metadata?: string | null;
}

export interface AuditEventResponseApiResponse {
  success?: boolean;
  data?: AuditEventResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AuditEventResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: AuditEventResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AuditEventResponsePagedResponse {
  items?: AuditEventResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface AuditEventResponsePagedResponseApiResponse {
  success?: boolean;
  data?: AuditEventResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface AuthenticatedUserResponse {
  id?: string;
  code?: string | null;
  displayName?: string | null;
  email?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  status?: UserStatus;
  privilegeLevel?: PrivilegeLevel;
  isSuperAdmin?: boolean;
  isTenantAdmin?: boolean;
  mfaEnabled?: boolean;
  mustChangePassword?: boolean;
  lastLoginAtUtc?: string | null;
  preferredCulture?: string | null;
  timeZone?: string | null;
  roles?: string[] | null;
  permissions?: string[] | null;
}

export interface BeginInvitationMfaEnrolmentRequest {
  token?: string | null;
  methodType?: MfaMethodType;
  mobileCountryCode?: string | null;
  mobileNumber?: string | null;
  label?: string | null;
}

export interface BeginMfaEnrolmentRequest {
  methodType?: MfaMethodType;
  label?: string | null;
}

export interface BulkOperationDetailResponse {
  id?: string;
  operationNumber?: string | null;
  actionType?: BulkActionType;
  actionDisplay?: string | null;
  status?: BulkOperationStatus;
  statusDisplay?: string | null;
  sourceFileName?: string | null;
  totalItemCount?: number;
  processedItemCount?: number;
  succeededItemCount?: number;
  failedItemCount?: number;
  skippedItemCount?: number;
  percentComplete?: number;
  validatedAtUtc?: string | null;
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
  failureSummary?: string | null;
  createdAtUtc?: string;
  requestedByName?: string | null;
  version?: number;
  items?: BulkOperationItemResponse[] | null;
  permittedActions?: string[] | null;
}

export interface BulkOperationDetailResponseApiResponse {
  success?: boolean;
  data?: BulkOperationDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface BulkOperationItemResponse {
  id?: string;
  rowNumber?: number;
  userId?: string | null;
  sourceIdentifier?: string | null;
  isValid?: boolean;
  validationMessage?: string | null;
  isProcessed?: boolean;
  succeeded?: boolean;
  wasSkipped?: boolean;
  resultMessage?: string | null;
}

export interface BulkOperationListItemResponse {
  id?: string;
  operationNumber?: string | null;
  actionType?: BulkActionType;
  actionDisplay?: string | null;
  status?: BulkOperationStatus;
  statusDisplay?: string | null;
  totalItemCount?: number;
  processedItemCount?: number;
  succeededItemCount?: number;
  failedItemCount?: number;
  percentComplete?: number;
  createdAtUtc?: string;
  requestedByName?: string | null;
  completedAtUtc?: string | null;
  version?: number;
}

export interface BulkOperationListItemResponsePagedResponse {
  items?: BulkOperationListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface BulkOperationListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: BulkOperationListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface BusinessUnitResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  legalName?: string | null;
  rootDomain?: string | null;
  status?: BusinessUnitStatus;
  contactEmail?: string | null;
  contactPhone?: string | null;
  supportEmail?: string | null;
  logoUrl?: string | null;
  timeZone?: string | null;
  defaultCurrency?: string | null;
  defaultCulture?: string | null;
  maximumTenants?: number | null;
  tenantCount?: number;
  description?: string | null;
  createdAtUtc?: string;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface BusinessUnitResponseApiResponse {
  success?: boolean;
  data?: BusinessUnitResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CancelAccessReviewRequest {
  reason?: string | null;
  expectedVersion?: number;
}

export interface CancelActivationRequest {
  token?: string | null;
  reason?: string | null;
}

export interface CancelMfaChallengeRequest {
  challengeToken?: string | null;
  reason?: string | null;
}

export interface ChangePasswordRequest {
  currentPassword?: string | null;
  newPassword?: string | null;
  confirmPassword?: string | null;
  signOutOtherSessions?: boolean;
}

export interface ChangePaymentGatewayStatusRequest {
  isActive?: boolean;
  expectedVersion?: number;
  reason?: string | null;
}

export interface ChangeRoleStatusRequest {
  status?: RoleStatus;
  expectedVersion?: number;
  reason?: string | null;
}

export interface CheckSubdomainRequest {
  subdomain?: string | null;
}

export interface CheckSubdomainResponse {
  subdomain?: string | null;
  isAvailable?: boolean;
  isReserved?: boolean;
  isValidFormat?: boolean;
  hostName?: string | null;
  message?: string | null;
  suggestions?: string[] | null;
}

export interface CheckSubdomainResponseApiResponse {
  success?: boolean;
  data?: CheckSubdomainResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CheckUserIdentityRequest {
  email?: string | null;
  username?: string | null;
  excludeUserId?: string | null;
}

export interface CheckUserIdentityResponse {
  isAvailable?: boolean;
  emailAvailable?: boolean;
  usernameAvailable?: boolean;
  message?: string | null;
  suggestions?: string[] | null;
}

export interface CheckUserIdentityResponseApiResponse {
  success?: boolean;
  data?: CheckUserIdentityResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CityDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  cityCode?: string | null;
  cityName?: string | null;
  displayName?: string | null;
  stateProvinceId?: string;
  stateProvinceCode?: string | null;
  stateProvinceName?: string | null;
  countryId?: string;
  countryCode?: string | null;
  countryName?: string | null;
  defaultPostalCodePattern?: string | null;
  isMetro?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  hasCoordinates?: boolean;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  notes?: string | null;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  permittedActions?: string[] | null;
  createdByName?: string | null;
  updatedByName?: string | null;
}

export interface CityDetailResponseApiResponse {
  success?: boolean;
  data?: CityDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CityListItemResponse {
  id?: string;
  tenantId?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  displayName?: string | null;
  stateProvinceId?: string;
  stateProvinceCode?: string | null;
  stateProvinceName?: string | null;
  countryId?: string;
  countryCode?: string | null;
  countryName?: string | null;
  isMetro?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface CityListItemResponsePagedResponse {
  items?: CityListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface CityListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: CityListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CloseAccessReviewCampaignRequest {
  expectedVersion?: number;
  notes?: string | null;
}

export interface ConfigureTenantMenuRequest {
  items?: TenantMenuItemRequest[] | null;
}

export interface ConfirmMfaEnrolmentRequest {
  code?: string | null;
}

export interface ContactSupportRequest {
  message?: string | null;
  contactEmail?: string | null;
  supportReference?: string | null;
}

export interface CountryDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  countryCode?: string | null;
  countryName?: string | null;
  officialName?: string | null;
  region?: GeographicRegion;
  iso2?: string | null;
  iso3?: string | null;
  numericCode?: string | null;
  flagEmoji?: string | null;
  defaultCurrencyCode?: string | null;
  hasStates?: boolean;
  postalCodePattern?: string | null;
  phoneCountryCode?: string | null;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  notes?: string | null;
  stateProvinceCount?: number;
  cityCount?: number;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  permittedActions?: string[] | null;
  createdByName?: string | null;
  updatedByName?: string | null;
}

export interface CountryDetailResponseApiResponse {
  success?: boolean;
  data?: CountryDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CountryListItemResponse {
  id?: string;
  tenantId?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  officialName?: string | null;
  region?: GeographicRegion;
  iso2?: string | null;
  iso3?: string | null;
  flagEmoji?: string | null;
  defaultCurrencyCode?: string | null;
  phoneCountryCode?: string | null;
  hasStates?: boolean;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  stateProvinceCount?: number;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface CountryListItemResponsePagedResponse {
  items?: CountryListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface CountryListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: CountryListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CountryLookupResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  iso2?: string | null;
  flagEmoji?: string | null;
  phoneCountryCode?: string | null;
  hasStates?: boolean;
  defaultCurrencyId?: string | null;
  defaultCurrencyCode?: string | null;
  primaryTimeZoneId?: string | null;
  timeZoneCount?: number;
  status?: MasterDataStatus;
  isPlatformRow?: boolean;
  sortOrder?: number;
}

export interface CountryLookupResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: CountryLookupResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CreateAccessRequestRequest {
  requestedForUserId?: string;
  requestType?: AccessRequestType;
  businessJustification?: string | null;
  roleId?: string | null;
  permissionCode?: string | null;
  scopeType?: DataScopeType;
  scopeValue?: string | null;
  accessStartsAtUtc?: string | null;
  accessEndsAtUtc?: string | null;
  submitImmediately?: boolean;
}

export interface CreateAccessReviewCampaignRequest {
  name?: string | null;
  dueAtUtc?: string;
  code?: string | null;
  description?: string | null;
  startsAtUtc?: string | null;
  revokeOnNoResponse?: boolean;
  roleIds?: string[] | null;
  userIds?: string[] | null;
  sensitiveOnly?: boolean;
}

export interface CreateAccessReviewRequest {
  subjectUserId?: string;
  reviewerUserId?: string;
  reviewDueAtUtc?: string;
  userRoleId?: string | null;
  roleId?: string | null;
}

export interface CreateBulkOperationRequest {
  actionType?: BulkActionType;
  userIds?: string[] | null;
  sourceFileName?: string | null;
  sourceStoragePath?: string | null;
  roleId?: string | null;
  accessEndsAtUtc?: string | null;
  reason?: string | null;
  applyImmediately?: boolean;
}

export interface CreateCityRequest {
  cityCode?: string | null;
  cityName?: string | null;
  stateProvinceId?: string;
  displayName?: string | null;
  defaultPostalCodePattern?: string | null;
  isMetro?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  status?: MasterDataStatus;
  sortOrder?: number;
  notes?: string | null;
}

export interface CreateCountryRequest {
  countryCode?: string | null;
  countryName?: string | null;
  iso2?: string | null;
  officialName?: string | null;
  region?: GeographicRegion;
  iso3?: string | null;
  numericCode?: string | null;
  defaultCurrencyCode?: string | null;
  hasStates?: boolean;
  postalCodePattern?: string | null;
  phoneCountryCode?: string | null;
  status?: MasterDataStatus;
  sortOrder?: number;
  notes?: string | null;
}

export interface CreateCurrencyRequest {
  currencyCode?: string | null;
  currencyName?: string | null;
  numericCode?: number | null;
  currencyType?: CurrencyType;
  symbol?: string | null;
  symbolPosition?: SymbolPosition;
  displayFormat?: string | null;
  decimalPlaces?: number;
  minorUnitName?: string | null;
  roundingMode?: RoundingMode;
  roundingStep?: number | null;
  status?: MasterDataStatus;
  sortOrder?: number;
  notes?: string | null;
}

export interface CreateDepartmentRequest {
  name?: string | null;
  code?: string | null;
  description?: string | null;
  parentDepartmentId?: string | null;
  headUserId?: string | null;
  displayOrder?: number;
}

export interface CreateDocumentSubmissionRequest {
  documentType?: TenantDocumentType;
  title?: string | null;
  notes?: string | null;
  referenceNumber?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
}

export interface CreateMenuDefinitionRequest {
  code?: string | null;
  name?: string | null;
  level?: MenuLevel;
  moduleCode?: string | null;
  parentMenuId?: string | null;
  route?: string | null;
  icon?: string | null;
  requiredPermissionCode?: string | null;
  description?: string | null;
  displayOrder?: number;
  isPlatformOnly?: boolean;
  isEnabledByDefault?: boolean;
  isMandatory?: boolean;
  opensInNewTab?: boolean;
  badgeKey?: string | null;
}

export interface CreateOrganisationRequest {
  name?: string | null;
  subdomain?: string | null;
  adminEmail?: string | null;
  adminFirstName?: string | null;
  adminLastName?: string | null;
  code?: string | null;
  legalName?: string | null;
  organisationType?: string | null;
  contactPhoneCountryCode?: string | null;
  contactPhone?: string | null;
  adminUsername?: string | null;
  timeZone?: string | null;
  defaultCurrency?: string | null;
  defaultCulture?: string | null;
  maximumUsers?: number | null;
  defaultMfaRequirement?: MfaRequirement;
  invitationMessage?: string | null;
  sendInvitation?: boolean;
  description?: string | null;
}

export interface CreateOrganisationResponse {
  tenantId?: string;
  code?: string | null;
  name?: string | null;
  subdomain?: string | null;
  hostName?: string | null;
  status?: TenantStatus;
  adminUserId?: string;
  adminEmail?: string | null;
  invitationSent?: boolean;
  invitationExpiresAtUtc?: string | null;
  activationUrl?: string | null;
  version?: number;
}

export interface CreateOrganisationResponseApiResponse {
  success?: boolean;
  data?: CreateOrganisationResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CreateOrganisationUnitRequest {
  name?: string | null;
  code?: string | null;
  description?: string | null;
  parentUnitId?: string | null;
  unitType?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  timeZone?: string | null;
  managerUserId?: string | null;
  displayOrder?: number;
}

export interface CreateRoleIncompatibilityRequest {
  roleId?: string;
  conflictingRoleId?: string;
  reason?: string | null;
  isBlocking?: boolean;
}

export interface CreateRoleRequest {
  name?: string | null;
  code?: string | null;
  description?: string | null;
  status?: RoleStatus;
  priority?: number;
  isPrivileged?: boolean;
  isDefaultRole?: boolean;
  displayTag?: string | null;
  permissionCodes?: string[] | null;
  visibleMenuIds?: string[] | null;
  deniedPermissionCodes?: string[] | null;
}

export interface CreateStateProvinceRequest {
  stateProvinceCode?: string | null;
  stateProvinceName?: string | null;
  countryId?: string;
  displayName?: string | null;
  jurisdictionType?: JurisdictionType;
  otherJurisdictionType?: string | null;
  isFederalJurisdiction?: boolean;
  gstStateCode?: string | null;
  stateTaxJurisdictionCode?: string | null;
  defaultTimeZoneId?: string | null;
  postalCodePattern?: string | null;
  addressFormatHint?: string | null;
  status?: MasterDataStatus;
  sortOrder?: number;
  notes?: string | null;
}

export interface CreateTimeZoneRequest {
  timeZoneKey?: string | null;
  displayName?: string | null;
  standardUtcOffsetMinutes?: number;
  shortName?: string | null;
  supportsDaylightSaving?: boolean;
  daylightSavingRuleNote?: string | null;
  isDefaultRecommended?: boolean;
  status?: MasterDataStatus;
  sortOrder?: number;
  notes?: string | null;
}

export interface CreateUserDataScopeRequest {
  scopeType?: DataScopeType;
  scopeValue?: string | null;
  displayLabel?: string | null;
  effectiveToUtc?: string | null;
}

export interface CreateUserRequest {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  middleName?: string | null;
  displayName?: string | null;
  username?: string | null;
  employeeNumber?: string | null;
  mobileCountryCode?: string | null;
  mobileNumber?: string | null;
  accountCategory?: UserAccountCategory;
  engagementType?: EngagementType;
  departmentId?: string | null;
  organisationUnitId?: string | null;
  designation?: string | null;
  managerUserId?: string | null;
  accessStartsAtUtc?: string | null;
  accessEndsAtUtc?: string | null;
  mfaRequirement?: MfaRequirement;
  joinedOn?: string | null;
  roleIds?: string[] | null;
  dataScopes?: CreateUserDataScopeRequest[] | null;
  sendInvitation?: boolean;
  credentialSetupMethod?: CredentialSetupMethod;
  invitationMessage?: string | null;
  title?: string | null;
  preferredName?: string | null;
  workLocation?: string | null;
  preferredCulture?: string | null;
  timeZone?: string | null;
  justification?: string | null;
}

export interface CreateUserResponse {
  id?: string;
  code?: string | null;
  displayName?: string | null;
  email?: string | null;
  status?: UserStatus;
  invitationSent?: boolean;
  invitationExpiresAtUtc?: string | null;
  activationUrl?: string | null;
  version?: number;
}

export interface CreateUserResponseApiResponse {
  success?: boolean;
  data?: CreateUserResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CurrencyDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  currencyCode?: string | null;
  currencyName?: string | null;
  numericCode?: number | null;
  currencyType?: CurrencyType;
  symbol?: string | null;
  symbolPosition?: SymbolPosition;
  displayFormat?: string | null;
  decimalPlaces?: number;
  minorUnitName?: string | null;
  roundingMode?: RoundingMode;
  roundingStep?: number | null;
  isZeroDecimal?: boolean;
  sampleAmount?: string | null;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  notes?: string | null;
  countryUsageCount?: number;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  permittedActions?: string[] | null;
  createdByName?: string | null;
  updatedByName?: string | null;
}

export interface CurrencyDetailResponseApiResponse {
  success?: boolean;
  data?: CurrencyDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CurrencyListItemResponse {
  id?: string;
  tenantId?: string | null;
  currencyCode?: string | null;
  currencyName?: string | null;
  numericCode?: number | null;
  currencyType?: CurrencyType;
  symbol?: string | null;
  symbolPosition?: SymbolPosition;
  decimalPlaces?: number;
  sampleAmount?: string | null;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface CurrencyListItemResponsePagedResponse {
  items?: CurrencyListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface CurrencyListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: CurrencyListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface CurrencyLookupResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  symbol?: string | null;
  decimalPlaces?: number;
  isDefaultForCountry?: boolean;
  status?: MasterDataStatus;
  isPlatformRow?: boolean;
  sortOrder?: number;
}

export interface CurrencyLookupResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: CurrencyLookupResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface DecideAccessRequestRequest {
  approved?: boolean;
  expectedVersion?: number;
  notes?: string | null;
  accessEndsAtUtc?: string | null;
}

export interface DecideAccessReviewRequest {
  decision?: AccessReviewDecision;
  expectedVersion?: number;
  decisionReason?: string | null;
  applyImmediately?: boolean;
}

export interface DecideDocumentSubmissionRequest {
  decision?: DocumentSubmissionDecision;
  expectedVersion?: number;
  notes?: string | null;
}

export interface DecideLoginIdentifierChangeRequest {
  requestId?: string;
  approved?: boolean;
  reason?: string | null;
}

export interface DelegateAccessReviewRequest {
  reviewerUserId?: string;
  reason?: string | null;
  expectedVersion?: number;
}

export interface DeleteMasterRequest {
  expectedVersion?: number;
  reason?: string | null;
}

export interface DeletePaymentGatewayConfigurationRequest {
  expectedVersion?: number;
  reason?: string | null;
}

export interface DeleteRoleRequest {
  expectedVersion?: number;
  reason?: string | null;
}

export interface DeleteStructureRequest {
  expectedVersion?: number;
  reason?: string | null;
}

export interface DepartmentResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  parentDepartmentId?: string | null;
  parentName?: string | null;
  headUserId?: string | null;
  headDisplayName?: string | null;
  status?: RecordStatus;
  displayOrder?: number;
  memberCount?: number;
  childCount?: number;
  version?: number;
}

export interface DepartmentResponseApiResponse {
  success?: boolean;
  data?: DepartmentResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface DepartmentResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: DepartmentResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface DocumentDownloadLinkResponse {
  documentId?: string;
  fileName?: string | null;
  contentType?: string | null;
  fileSizeBytes?: number;
  url?: string | null;
  expiresAtUtc?: string;
  isPreviewable?: boolean;
}

export interface DocumentDownloadLinkResponseApiResponse {
  success?: boolean;
  data?: DocumentDownloadLinkResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface DocumentSubmissionResponse {
  id?: string;
  tenantId?: string;
  organisationName?: string | null;
  organisationCode?: string | null;
  documentType?: TenantDocumentType;
  documentTypeDisplay?: string | null;
  title?: string | null;
  notes?: string | null;
  status?: TenantDocumentSubmissionStatus;
  statusDisplay?: string | null;
  submittedAtUtc?: string | null;
  submittedByName?: string | null;
  reviewStartedAtUtc?: string | null;
  decidedAtUtc?: string | null;
  reviewedByName?: string | null;
  decisionNotes?: string | null;
  reuploadCount?: number;
  fileCount?: number;
  totalSizeBytes?: number;
  fileKinds?: string[] | null;
  files?: SubmissionFileResponse[] | null;
  permittedActions?: string[] | null;
  version?: number;
}

export interface DocumentSubmissionResponseApiResponse {
  success?: boolean;
  data?: DocumentSubmissionResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface DocumentSubmissionResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: DocumentSubmissionResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface DocumentUploadPolicyResponse {
  maximumFileSizeMegabytes?: number;
  maximumFileSizeBytes?: number;
  maximumFilesPerSubmission?: number;
  allowedContentTypes?: string[] | null;
  allowedExtensions?: string[] | null;
  downloadLinkExpirySeconds?: number;
}

export interface DocumentUploadPolicyResponseApiResponse {
  success?: boolean;
  data?: DocumentUploadPolicyResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface EnumOption {
  value?: string | null;
  label?: string | null;
  ordinal?: number;
}

export interface EnumOptionsResponse {
  userStatuses?: EnumOption[] | null;
  accountCategories?: EnumOption[] | null;
  engagementTypes?: EnumOption[] | null;
  mfaRequirements?: EnumOption[] | null;
  mfaMethodTypes?: EnumOption[] | null;
  roleStatuses?: EnumOption[] | null;
  roleTypes?: EnumOption[] | null;
  permissionActions?: EnumOption[] | null;
  dataScopeTypes?: EnumOption[] | null;
  organisationStatuses?: EnumOption[] | null;
  documentTypes?: EnumOption[] | null;
  accessRequestTypes?: EnumOption[] | null;
  accessRequestStatuses?: EnumOption[] | null;
  accessReviewStatuses?: EnumOption[] | null;
  accessReviewDecisions?: EnumOption[] | null;
  bulkActionTypes?: EnumOption[] | null;
  clientTypes?: EnumOption[] | null;
  privilegeLevels?: EnumOption[] | null;
  recordStatuses?: EnumOption[] | null;
  menuLevels?: EnumOption[] | null;
  menuStatuses?: EnumOption[] | null;
  auditResults?: EnumOption[] | null;
  /** Stored text rather than enum members: value and label are the same label. */
  organisationTypes?: EnumOption[] | null;
}

export interface EnumOptionsResponseApiResponse {
  success?: boolean;
  data?: EnumOptionsResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface EscalateAccessReviewRequest {
  escalateToUserId?: string;
  reason?: string | null;
  expectedVersion?: number;
}

export interface ExtendUserAccessRequest {
  accessEndsAtUtc?: string | null;
  expectedVersion?: number;
  reason?: string | null;
}

export interface ForgotPasswordRequest {
  identifier?: string | null;
}

export interface ForgotPasswordResponse {
  message?: string | null;
  emailSent?: boolean;
}

export interface ForgotPasswordResponseApiResponse {
  success?: boolean;
  data?: ForgotPasswordResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface GeoLookupResponse {
  countries?: CountryLookupResponse[] | null;
  stateProvinces?: MasterLookupResponse[] | null;
  cities?: MasterLookupResponse[] | null;
  currencies?: CurrencyLookupResponse[] | null;
  timeZones?: TimeZoneLookupResponse[] | null;
  timeZonesAreCountryFiltered?: boolean;
  languages?: LanguageLookupResponse[] | null;
  languagesAreCountryFiltered?: boolean;
}

export interface GeoLookupResponseApiResponse {
  success?: boolean;
  data?: GeoLookupResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface GlobalMasterReferenceDataResponse {
  countries?: MasterLookupResponse[] | null;
  stateProvinces?: MasterLookupResponse[] | null;
  currencies?: MasterLookupResponse[] | null;
  timeZones?: MasterLookupResponse[] | null;
  regions?: EnumOption[] | null;
  jurisdictionTypes?: EnumOption[] | null;
  currencyTypes?: EnumOption[] | null;
  symbolPositions?: EnumOption[] | null;
  roundingModes?: EnumOption[] | null;
  statuses?: EnumOption[] | null;
}

export interface GlobalMasterReferenceDataResponseApiResponse {
  success?: boolean;
  data?: GlobalMasterReferenceDataResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface InvitationPreviewResponse {
  isValid?: boolean;
  email?: string | null;
  displayName?: string | null;
  tenantName?: string | null;
  tenantCode?: string | null;
  businessUnitName?: string | null;
  logoUrl?: string | null;
  invitationType?: InvitationType;
  expiresAtUtc?: string | null;
  requiresOrganisationProfile?: boolean;
  message?: string | null;
  username?: string | null;
  accountCategory?: string | null;
  department?: string | null;
  organisationUnit?: string | null;
  designation?: string | null;
  invitedRoleSummary?: string | null;
  accessStartsAtUtc?: string | null;
  accessEndsAtUtc?: string | null;
  passwordMinimumLength?: number;
  passwordMaximumLength?: number;
  passwordRequireUppercase?: boolean;
  passwordRequireLowercase?: boolean;
  passwordRequireDigit?: boolean;
  passwordRequireNonAlphanumeric?: boolean;
  mfaMandatory?: boolean;
  allowedMfaMethods?: MfaMethodType[] | null;
  /**
   * Dialling prefixes for the mobile number on the SMS/WhatsApp enrolment step.
   *
   * They arrive with the preview because the activation screen is anonymous and cannot call
   * the authenticated `/masters/lookups/countries` endpoint — doing so answered 401 and the
   * interceptor redirected the whole screen to sign-in.
   */
  dialingCodes?: string[] | null;
}

export interface InvitationPreviewResponseApiResponse {
  success?: boolean;
  data?: InvitationPreviewResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface LanguageLookupListResponse {
  languages?: LanguageLookupResponse[] | null;
  isCountryFiltered?: boolean;
}

export interface LanguageLookupListResponseApiResponse {
  success?: boolean;
  data?: LanguageLookupListResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface LanguageLookupResponse {
  id?: string;
  code?: string | null;
  cultureCode?: string | null;
  name?: string | null;
  nativeName?: string | null;
  displayLabel?: string | null;
  iso2?: string | null;
  isRightToLeft?: boolean;
  isPrimaryForCountry?: boolean;
  isOfficialInCountry?: boolean;
  isDefaultRecommended?: boolean;
  status?: MasterDataStatus;
  isPlatformRow?: boolean;
  sortOrder?: number;
}

export interface LoginIdentifierChangeResponse {
  id?: string;
  userId?: string;
  userDisplayName?: string | null;
  isEmailChange?: boolean;
  currentValue?: string | null;
  requestedValue?: string | null;
  status?: LoginIdentifierChangeStatus;
  statusDisplay?: string | null;
  requestedAtUtc?: string;
  requestedByName?: string | null;
  reason?: string | null;
  verifiedAtUtc?: string | null;
  previousOwnerNotifiedAtUtc?: string | null;
  approvedAtUtc?: string | null;
  approvedByName?: string | null;
  rejectedAtUtc?: string | null;
  rejectionReason?: string | null;
  appliedAtUtc?: string | null;
  expiresAtUtc?: string | null;
  requiresApproval?: boolean;
  version?: number;
  permittedActions?: string[] | null;
}

export interface LoginIdentifierChangeResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: LoginIdentifierChangeResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface LookupItem {
  id?: string;
  code?: string | null;
  name?: string | null;
  isActive?: boolean;
  description?: string | null;
}

export interface MapRoleMenusRequest {
  visibleMenuIds?: string[] | null;
  expectedVersion?: number;
  landingMenuId?: string | null;
}

export interface MasterLookupResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  status?: MasterDataStatus;
  isPlatformRow?: boolean;
  sortOrder?: number;
}

export interface MasterLookupResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: MasterLookupResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MasterStatusChangeRequest {
  expectedVersion?: number;
  reason?: string | null;
}

export interface MenuDefinitionResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  parentMenuId?: string | null;
  parentName?: string | null;
  level?: MenuLevel;
  moduleCode?: string | null;
  route?: string | null;
  icon?: string | null;
  requiredPermissionCode?: string | null;
  displayOrder?: number;
  status?: MenuStatus;
  isPlatformOnly?: boolean;
  isEnabledByDefault?: boolean;
  isMandatory?: boolean;
  opensInNewTab?: boolean;
  badgeKey?: string | null;
  version?: number;
  ownerTenantId?: string | null;
  isSystemDefined?: boolean;
  children?: MenuDefinitionResponse[] | null;
}

export interface MenuDefinitionResponseApiResponse {
  success?: boolean;
  data?: MenuDefinitionResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MenuDefinitionResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: MenuDefinitionResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MenuNode {
  id?: string;
  code?: string | null;
  name?: string | null;
  level?: MenuLevel;
  moduleCode?: string | null;
  route?: string | null;
  icon?: string | null;
  requiredPermissionCode?: string | null;
  displayOrder?: number;
  opensInNewTab?: boolean;
  badgeKey?: string | null;
  isLandingPage?: boolean;
  children?: MenuNode[] | null;
  isGroupOnly?: boolean;
  hasChildren?: boolean;
}

export interface MenuNodeIReadOnlyListApiResponse {
  success?: boolean;
  data?: MenuNode[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MenuPermissionOptionResponse {
  code?: string | null;
  name?: string | null;
  moduleCode?: string | null;
}

export interface MenuPermissionOptionResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: MenuPermissionOptionResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MfaChallengeResponse {
  challengeToken?: string | null;
  methodType?: MfaMethodType;
  maskedDestination?: string | null;
  expiresAtUtc?: string;
  attemptsRemaining?: number;
  availableMethods?: MfaMethodOptionResponse[] | null;
  recoveryCodeAccepted?: boolean;
  codeWasSent?: boolean;
  instruction?: string | null;
}

export interface MfaChallengeResponseApiResponse {
  success?: boolean;
  data?: MfaChallengeResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MfaEnrolmentResponse {
  methodId?: string;
  methodType?: MfaMethodType;
  sharedSecret?: string | null;
  provisioningUri?: string | null;
  maskedDestination?: string | null;
  message?: string | null;
}

export interface MfaEnrolmentResponseApiResponse {
  success?: boolean;
  data?: MfaEnrolmentResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface MfaMethodOptionResponse {
  id?: string;
  methodType?: MfaMethodType;
  label?: string | null;
  maskedDestination?: string | null;
  isPrimary?: boolean;
}

export interface MfaMethodResponse {
  id?: string;
  methodType?: MfaMethodType;
  label?: string | null;
  maskedDestination?: string | null;
  isPrimary?: boolean;
  status?: MfaMethodStatus;
  verifiedAtUtc?: string | null;
  lastUsedAtUtc?: string | null;
}

export interface NavigationResponse {
  menu?: MenuNode[] | null;
  landingRoute?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  scope?: AccessScopeType;
  isTenantMode?: boolean;
  isSuperAdmin?: boolean;
}

export interface NavigationResponseApiResponse {
  success?: boolean;
  data?: NavigationResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationAdminResponse {
  userId?: string;
  displayName?: string | null;
  email?: string | null;
  status?: UserStatus;
  hasActivated?: boolean;
  lastLoginAtUtc?: string | null;
  invitationExpiresAtUtc?: string | null;
  invitationPending?: boolean;
}

export interface OrganisationDetailResponse {
  id?: string;
  businessUnitId?: string;
  businessUnitName?: string | null;
  code?: string | null;
  name?: string | null;
  legalName?: string | null;
  subdomain?: string | null;
  hostName?: string | null;
  status?: TenantStatus;
  statusDisplay?: string | null;
  registrationNumber?: string | null;
  taxIdentificationNumber?: string | null;
  panNumber?: string | null;
  gstNumber?: string | null;
  organisationType?: string | null;
  establishedOn?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  contactPersonName?: string | null;
  contactEmail?: string | null;
  contactPhoneCountryCode?: string | null;
  contactPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  timeZone?: string | null;
  defaultCurrency?: string | null;
  defaultCulture?: string | null;
  defaultMfaRequirement?: MfaRequirement;
  maximumFailedAccessAttempts?: number;
  lockoutDurationMinutes?: number;
  passwordMinimumLength?: number;
  passwordExpiryDays?: number;
  sessionIdleTimeoutMinutes?: number;
  maximumUsers?: number | null;
  userCount?: number;
  invitedAtUtc?: string | null;
  invitationAcceptedAtUtc?: string | null;
  submittedAtUtc?: string | null;
  reviewStartedAtUtc?: string | null;
  approvedAtUtc?: string | null;
  rejectedAtUtc?: string | null;
  rejectionReason?: string | null;
  activatedAtUtc?: string | null;
  suspendedAtUtc?: string | null;
  suspensionReason?: string | null;
  resubmissionCount?: number;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  domains?: OrganisationDomainResponse[] | null;
  documents?: OrganisationDocumentResponse[] | null;
  timeline?: OrganisationTimelineResponse[] | null;
  primaryAdmin?: OrganisationAdminResponse;
  permittedActions?: string[] | null;
  outstandingProfileFields?: string[] | null;
  isProfileComplete?: boolean;
  /**
   * The profile fields the Organisation's current state still allows to be changed.
   *
   * Once SuperAdmin has approved it this narrows to contact e-mail, telephone and address —
   * the identity fields were verified against the uploaded documents and the server discards
   * them from a profile save afterwards. Absent means "an older API that has not been told to
   * restrict anything", which the screen treats as the whole form.
   */
  editableProfileFields?: string[] | null;
}

export interface OrganisationDetailResponseApiResponse {
  success?: boolean;
  data?: OrganisationDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationDocumentResponse {
  id?: string;
  documentType?: TenantDocumentType;
  documentTypeDisplay?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  fileSizeBytes?: number;
  status?: TenantDocumentStatus;
  referenceNumber?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  isExpired?: boolean;
  uploadedAtUtc?: string;
  uploadedByName?: string | null;
  reviewedAtUtc?: string | null;
  reviewedByName?: string | null;
  reviewNotes?: string | null;
  /** Null for files uploaded before grouped submissions existed. */
  submissionId?: string | null;
}

export interface OrganisationDocumentResponseApiResponse {
  success?: boolean;
  data?: OrganisationDocumentResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationDocumentResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: OrganisationDocumentResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationDomainResponse {
  id?: string;
  hostName?: string | null;
  domainType?: TenantDomainType;
  isPrimary?: boolean;
  isVerified?: boolean;
  isActive?: boolean;
  verifiedAtUtc?: string | null;
  verificationToken?: string | null;
}

export interface OrganisationDomainResponseApiResponse {
  success?: boolean;
  data?: OrganisationDomainResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationDomainResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: OrganisationDomainResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationListItemResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  subdomain?: string | null;
  hostName?: string | null;
  status?: TenantStatus;
  statusDisplay?: string | null;
  logoUrl?: string | null;
  country?: string | null;
  userCount?: number;
  adminEmail?: string | null;
  createdAtUtc?: string;
  updatedAtUtc?: string | null;
  isAwaitingReview?: boolean;
  version?: number;
}

export interface OrganisationListItemResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: OrganisationListItemResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationListItemResponsePagedResponse {
  items?: OrganisationListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface OrganisationListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: OrganisationListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationStatisticsResponse {
  total?: number;
  active?: number;
  awaitingReview?: number;
  onboarding?: number;
  suspended?: number;
  archived?: number;
  rejected?: number;
  byStatus?: Record<string, number> | null;
}

export interface OrganisationStatisticsResponseApiResponse {
  success?: boolean;
  data?: OrganisationStatisticsResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationTimelineResponse {
  id?: string;
  fromStatus?: TenantStatus;
  toStatus?: TenantStatus;
  toStatusDisplay?: string | null;
  occurredAtUtc?: string;
  actorDisplayName?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export interface OrganisationTimelineResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: OrganisationTimelineResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationUnitResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  parentUnitId?: string | null;
  parentName?: string | null;
  unitType?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  timeZone?: string | null;
  managerUserId?: string | null;
  managerDisplayName?: string | null;
  status?: RecordStatus;
  displayOrder?: number;
  memberCount?: number;
  childCount?: number;
  version?: number;
}

export interface OrganisationUnitResponseApiResponse {
  success?: boolean;
  data?: OrganisationUnitResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OrganisationUnitResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: OrganisationUnitResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface OutcomeResponse {
  id?: string;
  status?: string | null;
  version?: number;
  message?: string | null;
  permittedActions?: string[] | null;
}

export interface OutcomeResponseApiResponse {
  success?: boolean;
  data?: OutcomeResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PasswordOperationResponse {
  succeeded?: boolean;
  message?: string | null;
  requiresSignIn?: boolean;
  policy?: PasswordPolicyResponse;
}

export interface PasswordOperationResponseApiResponse {
  success?: boolean;
  data?: PasswordOperationResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PasswordPolicyResponse {
  minimumLength?: number;
  maximumLength?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireDigit?: boolean;
  requireNonAlphanumeric?: boolean;
  historyCount?: number;
}

export interface PasswordPolicyResponseApiResponse {
  success?: boolean;
  data?: PasswordPolicyResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PaymentGatewayCatalogueResponse {
  providers?: PaymentGatewayProviderOption[] | null;
  webhookEvents?: PaymentGatewayEventOption[] | null;
  paymentMethods?: PaymentGatewayMethodOption[] | null;
  webhookUrlTemplate?: string | null;
}

export interface PaymentGatewayCatalogueResponseApiResponse {
  success?: boolean;
  data?: PaymentGatewayCatalogueResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PaymentGatewayConfigurationAuditResponse {
  id?: string;
  configurationId?: string;
  tenantId?: string;
  organisationName?: string | null;
  provider?: string | null;
  environment?: string | null;
  action?: string | null;
  fieldName?: string | null;
  fieldLabel?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  occurredAtUtc?: string;
  reason?: string | null;
  ipAddress?: string | null;
  correlationId?: string | null;
}

export interface PaymentGatewayConfigurationAuditResponsePagedResponse {
  items?: PaymentGatewayConfigurationAuditResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface PaymentGatewayConfigurationAuditResponsePagedResponseApiResponse {
  success?: boolean;
  data?: PaymentGatewayConfigurationAuditResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PaymentGatewayConfigurationResponse {
  id?: string;
  tenantId?: string;
  organisationName?: string | null;
  organisationCode?: string | null;
  provider?: string | null;
  providerName?: string | null;
  environment?: string | null;
  displayName?: string | null;
  merchantId?: string | null;
  apiKeyHint?: string | null;
  hasApiKey?: boolean;
  hasSecretKey?: boolean;
  webhookUrl?: string | null;
  hasWebhookSecret?: boolean;
  subscribedEvents?: string[] | null;
  settlementCurrencyCode?: string | null;
  returnUrl?: string | null;
  paymentLinkValidityMinutes?: number;
  enabledMethods?: string[] | null;
  isActive?: boolean;
  isAdapterAvailable?: boolean;
  lastTestedAtUtc?: string | null;
  lastTestSucceeded?: boolean | null;
  lastTestMessage?: string | null;
  notes?: string | null;
  createdAtUtc?: string;
  updatedAtUtc?: string | null;
  version?: number;
  permittedActions?: string[] | null;
  source?: string | null;
  isSuperseded?: boolean;
  deploymentKeyReference?: string | null;
}

export interface PaymentGatewayConfigurationResponseApiResponse {
  success?: boolean;
  data?: PaymentGatewayConfigurationResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PaymentGatewayConfigurationResponsePagedResponse {
  items?: PaymentGatewayConfigurationResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface PaymentGatewayConfigurationResponsePagedResponseApiResponse {
  success?: boolean;
  data?: PaymentGatewayConfigurationResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PaymentGatewayEventOption {
  code?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface PaymentGatewayMethodOption {
  code?: string | null;
  name?: string | null;
}

export interface PaymentGatewayProviderOption {
  code?: string | null;
  name?: string | null;
  hasAdapter?: boolean;
  apiKeyLabel?: string | null;
  secretKeyLabel?: string | null;
  merchantIdLabel?: string | null;
  testKeyPrefix?: string | null;
  liveKeyPrefix?: string | null;
  documentationUrl?: string | null;
}

export interface PaymentGatewayTestResultResponse {
  configurationId?: string;
  provider?: string | null;
  environment?: string | null;
  succeeded?: boolean;
  message?: string | null;
  reference?: string | null;
  durationMilliseconds?: number;
  testedAtUtc?: string;
}

export interface PaymentGatewayTestResultResponseApiResponse {
  success?: boolean;
  data?: PaymentGatewayTestResultResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PermissionGroupResponse {
  moduleCode?: string | null;
  groupCode?: string | null;
  permissions?: PermissionSummaryResponse[] | null;
  moduleName?: string | null;
}

export interface PermissionListItemResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  moduleCode?: string | null;
  groupCode?: string | null;
  action?: PermissionAction;
  isSensitive?: boolean;
  isPlatformOnly?: boolean;
  status?: PermissionStatus;
  displayOrder?: number;
}

export interface PermissionListItemResponsePagedResponse {
  items?: PermissionListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface PermissionListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: PermissionListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PermissionMatrixGroupResponse {
  groupCode?: string | null;
  groupName?: string | null;
  permissions?: PermissionMatrixItemResponse[] | null;
}

export interface PermissionMatrixItemResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  action?: PermissionAction;
  isSensitive?: boolean;
  isGranted?: boolean;
  isDenied?: boolean;
  isImplicitlyGranted?: boolean;
}

export interface PermissionMatrixResponse {
  roleId?: string | null;
  roleName?: string | null;
  grantsAllTenantPermissions?: boolean;
  modules?: PermissionModuleResponse[] | null;
  totalPermissionCount?: number;
  grantedCount?: number;
  sensitiveGrantedCount?: number;
}

export interface PermissionMatrixResponseApiResponse {
  success?: boolean;
  data?: PermissionMatrixResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PermissionModuleResponse {
  moduleCode?: string | null;
  moduleName?: string | null;
  groups?: PermissionMatrixGroupResponse[] | null;
  grantedCount?: number;
  totalCount?: number;
}

export interface PermissionSummaryResponse {
  code?: string | null;
  name?: string | null;
  action?: PermissionAction;
  isSensitive?: boolean;
  isGranted?: boolean;
  grantedVia?: string | null;
}

export interface PersonLookupResponse {
  id?: string;
  displayName?: string | null;
  code?: string | null;
  roleName?: string | null;
  unitName?: string | null;
}

export interface PersonLookupResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: PersonLookupResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface PreviewUserAccessRequest {
  roleIds?: string[] | null;
}

export interface ReactivateOrganisationRequest {
  expectedVersion?: number;
  notes?: string | null;
}

export interface ReactivateUserRequest {
  expectedVersion?: number;
  notes?: string | null;
}

export interface ReasonRequest {
  reason?: string | null;
  expectedVersion?: number;
}

export interface ReauthenticateRequest {
  password?: string | null;
  mfaCode?: string | null;
  draftToken?: string | null;
}

export interface ReauthenticateResponse {
  succeeded?: boolean;
  stepUpToken?: string | null;
  validUntilUtc?: string | null;
  draftPayload?: string | null;
  message?: string | null;
}

export interface ReauthenticateResponseApiResponse {
  success?: boolean;
  data?: ReauthenticateResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface ReauthenticationViewResponse {
  isAuthenticated?: boolean;
  displayName?: string | null;
  email?: string | null;
  verificationCodeRequired?: boolean;
  secondsUntilSessionEnds?: number;
  protectedActionSummary?: string | null;
  draftToken?: string | null;
  unsavedWorkNotice?: string | null;
  message?: string | null;
}

export interface ReauthenticationViewResponseApiResponse {
  success?: boolean;
  data?: ReauthenticationViewResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RecoveryCodesResponse {
  codes?: string[] | null;
  count?: number;
  message?: string | null;
}

export interface RecoveryCodesResponseApiResponse {
  success?: boolean;
  data?: RecoveryCodesResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RedeemRecoveryCodeRequest {
  challengeToken?: string | null;
  recoveryCode?: string | null;
}

export interface ReferenceDataResponse {
  roles?: LookupItem[] | null;
  departments?: LookupItem[] | null;
  organisationUnits?: LookupItem[] | null;
  managers?: LookupItem[] | null;
  permissions?: LookupItem[] | null;
  selectableOrganisations?: LookupItem[] | null;
  enums?: EnumOptionsResponse;
  currentTenantId?: string | null;
  currentTenantName?: string | null;
  isSuperAdmin?: boolean;
  isTenantAdmin?: boolean;
}

export interface ReferenceDataResponseApiResponse {
  success?: boolean;
  data?: ReferenceDataResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RefreshTokenRequest {
  refreshToken?: string | null;
}

export interface RequestLoginIdentifierChangeRequest {
  isEmailChange?: boolean;
  requestedValue?: string | null;
  reason?: string | null;
}

export interface RequestNewInvitationRequest {
  token?: string | null;
}

export interface RequestNewRecoveryLinkRequest {
  identifier?: string | null;
}

export interface ResendInvitationRequest {
  userId?: string;
  message?: string | null;
}

export interface ResendMfaChallengeRequest {
  challengeToken?: string | null;
  mfaMethodId?: string | null;
}

export interface ResetPasswordRequest {
  token?: string | null;
  password?: string | null;
  confirmPassword?: string | null;
}

export interface ResetPasswordViewResponse {
  isTokenValid?: boolean;
  tokenExpiresAtUtc?: string | null;
  passwordMinimumLength?: number;
  passwordMaximumLength?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireDigit?: boolean;
  requireNonAlphanumeric?: boolean;
  passwordHistoryCount?: number;
  sessionRevocationNotice?: string | null;
  message?: string | null;
}

export interface ResetPasswordViewResponseApiResponse {
  success?: boolean;
  data?: ResetPasswordViewResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface ReturnAccessRequestRequest {
  reason?: string | null;
  expectedVersion?: number;
}

export interface ReviewOrganisationDocumentRequest {
  documentId?: string;
  accepted?: boolean;
  notes?: string | null;
}

export interface ReviewOrganisationRequest {
  approved?: boolean;
  expectedVersion?: number;
  reason?: string | null;
  notes?: string | null;
  activateImmediately?: boolean;
}

export interface RevokeMfaMethodRequest {
  reason?: string | null;
}

export interface RevokeMySessionRequest {
  reason?: string | null;
}

export interface RevokeTrustedDeviceRequest {
  reason?: string | null;
}

export interface RoleClaimRequest {
  claimType?: string | null;
  claimValue?: string | null;
  description?: string | null;
}

export interface RoleClaimResponse {
  id?: number;
  claimType?: string | null;
  claimValue?: string | null;
  description?: string | null;
}

export interface RoleDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  roleType?: RoleType;
  status?: RoleStatus;
  statusDisplay?: string | null;
  isSystemRole?: boolean;
  isDefaultRole?: boolean;
  isPrivileged?: boolean;
  grantsAllTenantPermissions?: boolean;
  priority?: number;
  displayTag?: string | null;
  memberCount?: number;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  permissions?: RolePermissionResponse[] | null;
  claims?: RoleClaimResponse[] | null;
  incompatibilities?: RoleIncompatibilityResponse[] | null;
  visibleMenuIds?: string[] | null;
  permittedActions?: string[] | null;
}

export interface RoleDetailResponseApiResponse {
  success?: boolean;
  data?: RoleDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RoleIncompatibilityResponse {
  id?: string;
  roleId?: string;
  roleName?: string | null;
  conflictingRoleId?: string;
  conflictingRoleName?: string | null;
  reason?: string | null;
  isBlocking?: boolean;
  isActive?: boolean;
}

export interface RoleIncompatibilityResponseApiResponse {
  success?: boolean;
  data?: RoleIncompatibilityResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RoleListItemResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  roleType?: RoleType;
  status?: RoleStatus;
  statusDisplay?: string | null;
  isSystemRole?: boolean;
  isDefaultRole?: boolean;
  isPrivileged?: boolean;
  grantsAllTenantPermissions?: boolean;
  priority?: number;
  displayTag?: string | null;
  permissionCount?: number;
  memberCount?: number;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface RoleListItemResponsePagedResponse {
  items?: RoleListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface RoleListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: RoleListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RoleLookupResponse {
  id?: string;
  code?: string | null;
  name?: string | null;
  status?: RoleStatus;
  isPrivileged?: boolean;
  isDefaultRole?: boolean;
  permissionCount?: number;
}

export interface RoleLookupResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: RoleLookupResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RoleMemberResponse {
  userRoleId?: string;
  userId?: string;
  userCode?: string | null;
  displayName?: string | null;
  email?: string | null;
  userStatus?: UserStatus;
  assignmentStatus?: UserRoleAssignmentStatus;
  isPrimary?: boolean;
  isEffective?: boolean;
  assignedAtUtc?: string;
  effectiveToUtc?: string | null;
}

export interface RoleMemberResponsePagedResponse {
  items?: RoleMemberResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface RoleMemberResponsePagedResponseApiResponse {
  success?: boolean;
  data?: RoleMemberResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RoleMenuMappingResponse {
  roleId?: string;
  roleName?: string | null;
  landingMenuId?: string | null;
  nodes?: RoleMenuNodeResponse[] | null;
}

export interface RoleMenuMappingResponseApiResponse {
  success?: boolean;
  data?: RoleMenuMappingResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface RoleMenuNodeResponse {
  menuDefinitionId?: string;
  code?: string | null;
  name?: string | null;
  level?: MenuLevel;
  moduleCode?: string | null;
  route?: string | null;
  requiredPermissionCode?: string | null;
  isVisible?: boolean;
  isPermitted?: boolean;
  isLandingPage?: boolean;
  isEnabledForOrganisation?: boolean;
  children?: RoleMenuNodeResponse[] | null;
}

export interface RolePermissionResponse {
  id?: string;
  permissionId?: string;
  permissionCode?: string | null;
  permissionName?: string | null;
  moduleCode?: string | null;
  groupCode?: string | null;
  action?: PermissionAction;
  isSensitive?: boolean;
  isDenied?: boolean;
  grantedAtUtc?: string;
  expiresAtUtc?: string | null;
  moduleName?: string | null;
}

export interface SaveProtectedDraftRequest {
  actionCode?: string | null;
  payload?: string | null;
  targetId?: string | null;
}

export interface SaveProtectedDraftResponse {
  draftToken?: string | null;
  message?: string | null;
}

export interface SaveProtectedDraftResponseApiResponse {
  success?: boolean;
  data?: SaveProtectedDraftResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface SelectTenantRequest {
  tenantId?: string;
}

export interface SelectTenantResponse {
  accessToken?: string | null;
  accessTokenExpiresAtUtc?: string;
  expiresInSeconds?: number;
  tokenType?: string | null;
  sessionId?: string;
  tenant?: TenantContextResponse;
  user?: AuthenticatedUserResponse;
}

export interface SelectTenantResponseApiResponse {
  success?: boolean;
  data?: SelectTenantResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface SessionStatusResponse {
  isAuthenticated?: boolean;
  sessionId?: string | null;
  issuedAtUtc?: string | null;
  expiresAtUtc?: string | null;
  lastActivityAtUtc?: string | null;
  idleTimeoutMinutes?: number;
  secondsUntilIdleTimeout?: number;
  mfaCompleted?: boolean;
  requiresReauthentication?: boolean;
  user?: AuthenticatedUserResponse;
  tenant?: TenantContextResponse;
}

export interface SessionStatusResponseApiResponse {
  success?: boolean;
  data?: SessionStatusResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface SignInAttemptResponse {
  id?: string;
  outcome?: SignInOutcome;
  outcomeDisplay?: string | null;
  succeeded?: boolean;
  attemptedAtUtc?: string;
  ipAddress?: string | null;
  clientType?: ClientType;
  browser?: string | null;
  operatingSystem?: string | null;
  location?: string | null;
  attemptsRemaining?: number;
  triggeredLockout?: boolean;
}

export interface SignInRequest {
  identifier?: string | null;
  password?: string | null;
  rememberMe?: boolean;
  clientType?: ClientType;
  deviceIdentifier?: string | null;
  deviceName?: string | null;
  trustedDeviceToken?: string | null;
}

export interface SignInResponse {
  status?: SignInResultStatus;
  accessToken?: string | null;
  accessTokenExpiresAtUtc?: string | null;
  expiresInSeconds?: number;
  tokenType?: string | null;
  refreshToken?: string | null;
  refreshTokenExpiresAtUtc?: string | null;
  sessionId?: string | null;
  user?: AuthenticatedUserResponse;
  tenant?: TenantContextResponse;
  challengeToken?: string | null;
  mfaMaskedDestination?: string | null;
  mfaMethodType?: MfaMethodType;
  selectableTenants?: TenantOptionResponse[] | null;
  passwordResetToken?: string | null;
  attemptsRemaining?: number | null;
  lockoutMinutesRemaining?: number | null;
  message?: string | null;
}

export interface SignInResponseApiResponse {
  success?: boolean;
  data?: SignInResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface SignOutRequest {
  allDevices?: boolean;
}

export interface StartOrganisationReviewRequest {
  expectedVersion?: number;
}

export interface StartRecoveryRequest {
  identifier?: string | null;
}

export interface StateProvinceDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  stateProvinceCode?: string | null;
  stateProvinceName?: string | null;
  displayName?: string | null;
  countryId?: string;
  countryCode?: string | null;
  countryName?: string | null;
  jurisdictionType?: JurisdictionType;
  jurisdictionDescription?: string | null;
  otherJurisdictionType?: string | null;
  isFederalJurisdiction?: boolean;
  gstStateCode?: string | null;
  stateTaxJurisdictionCode?: string | null;
  defaultTimeZoneId?: string | null;
  defaultTimeZoneName?: string | null;
  postalCodePattern?: string | null;
  addressFormatHint?: string | null;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  notes?: string | null;
  cityCount?: number;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  permittedActions?: string[] | null;
  createdByName?: string | null;
  updatedByName?: string | null;
}

export interface StateProvinceDetailResponseApiResponse {
  success?: boolean;
  data?: StateProvinceDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface StateProvinceListItemResponse {
  id?: string;
  tenantId?: string | null;
  stateProvinceCode?: string | null;
  stateProvinceName?: string | null;
  displayName?: string | null;
  countryId?: string;
  countryCode?: string | null;
  countryName?: string | null;
  jurisdictionType?: JurisdictionType;
  jurisdictionDescription?: string | null;
  isFederalJurisdiction?: boolean;
  gstStateCode?: string | null;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  cityCount?: number;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface StateProvinceListItemResponsePagedResponse {
  items?: StateProvinceListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface StateProvinceListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: StateProvinceListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface StringIReadOnlyListApiResponse {
  success?: boolean;
  data?: string[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface SubmissionFileResponse {
  id?: string;
  fileName?: string | null;
  contentType?: string | null;
  fileSizeBytes?: number;
  contentHash?: string | null;
  status?: TenantDocumentStatus;
  uploadedAtUtc?: string;
  uploadedByName?: string | null;
  isPreviewable?: boolean;
  supersededByDocumentId?: string | null;
}

export interface SubmitAccessRequestRequest {
  expectedVersion?: number;
  comment?: string | null;
}

export interface SubmitDocumentSubmissionRequest {
  expectedVersion?: number;
  notes?: string | null;
}

export interface SubmitOrganisationRequest {
  expectedVersion?: number;
  notes?: string | null;
}

export interface SuspendOrganisationRequest {
  reason?: string | null;
  expectedVersion?: number;
}

export interface TenantContextResponse {
  tenantId?: string | null;
  tenantCode?: string | null;
  tenantName?: string | null;
  subdomain?: string | null;
  status?: TenantStatus;
  businessUnitId?: string;
  businessUnitCode?: string | null;
  businessUnitName?: string | null;
  scope?: AccessScopeType;
  isTenantMode?: boolean;
  logoUrl?: string | null;
  timeZone?: string | null;
  defaultCurrency?: string | null;
  defaultCulture?: string | null;
}

export interface TenantMenuConfigurationResponse {
  tenantId?: string;
  tenantName?: string | null;
  nodes?: TenantMenuNodeResponse[] | null;
}

export interface TenantMenuConfigurationResponseApiResponse {
  success?: boolean;
  data?: TenantMenuConfigurationResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TenantMenuItemRequest {
  menuDefinitionId?: string;
  isEnabled?: boolean;
  displayNameOverride?: string | null;
  iconOverride?: string | null;
  displayOrderOverride?: number | null;
}

export interface TenantMenuNodeResponse {
  menuDefinitionId?: string;
  code?: string | null;
  catalogueName?: string | null;
  resolvedName?: string | null;
  level?: MenuLevel;
  moduleCode?: string | null;
  route?: string | null;
  resolvedIcon?: string | null;
  requiredPermissionCode?: string | null;
  resolvedOrder?: number;
  isEnabled?: boolean;
  isMandatory?: boolean;
  displayNameOverride?: string | null;
  iconOverride?: string | null;
  displayOrderOverride?: number | null;
  isOrganisationOwned?: boolean;
  version?: number;
  parentMenuDefinitionId?: string | null;
  children?: TenantMenuNodeResponse[] | null;
}

export interface TenantOptionResponse {
  tenantId?: string;
  code?: string | null;
  name?: string | null;
  subdomain?: string | null;
  status?: TenantStatus;
  logoUrl?: string | null;
  isOperable?: boolean;
}

export interface TenantOptionResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: TenantOptionResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TenantResolutionResponse {
  resolved?: boolean;
  tenantId?: string | null;
  tenantCode?: string | null;
  tenantName?: string | null;
  subdomain?: string | null;
  status?: TenantStatus;
  isOperable?: boolean;
  isPlatformHost?: boolean;
  logoUrl?: string | null;
  businessUnitId?: string;
  businessUnitName?: string | null;
  message?: string | null;
}

export interface TenantResolutionResponseApiResponse {
  success?: boolean;
  data?: TenantResolutionResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TimeZoneDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  timeZoneKey?: string | null;
  displayName?: string | null;
  shortName?: string | null;
  standardUtcOffsetMinutes?: number;
  offsetDisplay?: string | null;
  supportsDaylightSaving?: boolean;
  daylightSavingRuleNote?: string | null;
  isDefaultRecommended?: boolean;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  notes?: string | null;
  stateUsageCount?: number;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  permittedActions?: string[] | null;
  createdByName?: string | null;
  updatedByName?: string | null;
}

export interface TimeZoneDetailResponseApiResponse {
  success?: boolean;
  data?: TimeZoneDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TimeZoneListItemResponse {
  id?: string;
  tenantId?: string | null;
  timeZoneKey?: string | null;
  displayName?: string | null;
  shortName?: string | null;
  standardUtcOffsetMinutes?: number;
  offsetDisplay?: string | null;
  supportsDaylightSaving?: boolean;
  isDefaultRecommended?: boolean;
  status?: MasterDataStatus;
  statusDescription?: string | null;
  isActive?: boolean;
  isPlatformRow?: boolean;
  sortOrder?: number;
  updatedAtUtc?: string | null;
  version?: number;
}

export interface TimeZoneListItemResponsePagedResponse {
  items?: TimeZoneListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface TimeZoneListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: TimeZoneListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TimeZoneLookupListResponse {
  timeZones?: TimeZoneLookupResponse[] | null;
  isCountryFiltered?: boolean;
}

export interface TimeZoneLookupListResponseApiResponse {
  success?: boolean;
  data?: TimeZoneLookupListResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TimeZoneLookupResponse {
  id?: string;
  code?: string | null;
  ianaKey?: string | null;
  name?: string | null;
  shortName?: string | null;
  offsetDisplay?: string | null;
  standardUtcOffsetMinutes?: number;
  supportsDaylightSaving?: boolean;
  isPrimaryForCountry?: boolean;
  isDefaultRecommended?: boolean;
  status?: MasterDataStatus;
  isPlatformRow?: boolean;
  sortOrder?: number;
}

export interface TokenResponse {
  accessToken?: string | null;
  accessTokenExpiresAtUtc?: string;
  expiresInSeconds?: number;
  tokenType?: string | null;
  refreshToken?: string | null;
  refreshTokenExpiresAtUtc?: string;
  sessionId?: string;
  user?: AuthenticatedUserResponse;
  tenant?: TenantContextResponse;
}

export interface TokenResponseApiResponse {
  success?: boolean;
  data?: TokenResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface TransitionRequest {
  expectedVersion?: number;
  comment?: string | null;
}

export interface TrustedDeviceResponse {
  id?: string;
  deviceName?: string | null;
  clientType?: ClientType;
  browser?: string | null;
  operatingSystem?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  trustedAtUtc?: string;
  expiresAtUtc?: string;
  lastSeenAtUtc?: string | null;
  isExpired?: boolean;
}

export interface UnlockUserRequest {
  expectedVersion?: number;
  reason?: string | null;
}

export interface UpdateAccessRequestRequest {
  expectedVersion?: number;
  businessJustification?: string | null;
  roleId?: string | null;
  accessStartsAtUtc?: string | null;
  accessEndsAtUtc?: string | null;
}

export interface UpdateCityRequest {
  expectedVersion?: number;
  cityName?: string | null;
  displayName?: string | null;
  defaultPostalCodePattern?: string | null;
  isMetro?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  sortOrder?: number | null;
  notes?: string | null;
  clearCoordinates?: boolean;
}

export interface UpdateCountryRequest {
  expectedVersion?: number;
  countryName?: string | null;
  officialName?: string | null;
  region?: GeographicRegion;
  iso2?: string | null;
  iso3?: string | null;
  numericCode?: string | null;
  defaultCurrencyCode?: string | null;
  hasStates?: boolean | null;
  postalCodePattern?: string | null;
  phoneCountryCode?: string | null;
  sortOrder?: number | null;
  notes?: string | null;
}

export interface UpdateCurrencyRequest {
  expectedVersion?: number;
  currencyName?: string | null;
  numericCode?: number | null;
  currencyType?: CurrencyType;
  symbol?: string | null;
  symbolPosition?: SymbolPosition;
  displayFormat?: string | null;
  decimalPlaces?: number | null;
  minorUnitName?: string | null;
  roundingMode?: RoundingMode;
  roundingStep?: number | null;
  sortOrder?: number | null;
  notes?: string | null;
  clearRoundingStep?: boolean;
}

export interface UpdateDepartmentRequest {
  expectedVersion?: number;
  name?: string | null;
  code?: string | null;
  description?: string | null;
  parentDepartmentId?: string | null;
  headUserId?: string | null;
  status?: RecordStatus;
  displayOrder?: number | null;
}

export interface UpdateMenuDefinitionRequest {
  expectedVersion?: number;
  name?: string | null;
  description?: string | null;
  route?: string | null;
  icon?: string | null;
  requiredPermissionCode?: string | null;
  displayOrder?: number | null;
  status?: MenuStatus;
  isEnabledByDefault?: boolean | null;
  opensInNewTab?: boolean | null;
  badgeKey?: string | null;
}

export interface UpdateMyProfileRequest {
  expectedVersion?: number;
  displayName?: string | null;
  mobileCountryCode?: string | null;
  mobileNumber?: string | null;
  designation?: string | null;
  preferredCulture?: string | null;
  timeZone?: string | null;
  reason?: string | null;
  title?: string | null;
  preferredName?: string | null;
  workLocation?: string | null;
}

export interface UpdateOrganisationProfileRequest {
  expectedVersion?: number;
  name?: string | null;
  legalName?: string | null;
  registrationNumber?: string | null;
  taxIdentificationNumber?: string | null;
  panNumber?: string | null;
  gstNumber?: string | null;
  organisationType?: string | null;
  establishedOn?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  contactPersonName?: string | null;
  contactEmail?: string | null;
  contactPhoneCountryCode?: string | null;
  contactPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  timeZone?: string | null;
  defaultCurrency?: string | null;
  defaultCulture?: string | null;
}

export interface UpdateOrganisationSettingsRequest {
  expectedVersion?: number;
  defaultMfaRequirement?: MfaRequirement;
  maximumFailedAccessAttempts?: number | null;
  lockoutDurationMinutes?: number | null;
  passwordMinimumLength?: number | null;
  passwordExpiryDays?: number | null;
  sessionIdleTimeoutMinutes?: number | null;
}

export interface UpdateOrganisationUnitRequest {
  expectedVersion?: number;
  name?: string | null;
  code?: string | null;
  description?: string | null;
  parentUnitId?: string | null;
  unitType?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  timeZone?: string | null;
  managerUserId?: string | null;
  status?: RecordStatus;
  displayOrder?: number | null;
}

export interface UpdateRoleRequest {
  expectedVersion?: number;
  name?: string | null;
  description?: string | null;
  priority?: number | null;
  isPrivileged?: boolean | null;
  isDefaultRole?: boolean | null;
  displayTag?: string | null;
}

export interface UpdateStateProvinceRequest {
  expectedVersion?: number;
  stateProvinceName?: string | null;
  displayName?: string | null;
  jurisdictionType?: JurisdictionType;
  otherJurisdictionType?: string | null;
  isFederalJurisdiction?: boolean | null;
  gstStateCode?: string | null;
  stateTaxJurisdictionCode?: string | null;
  defaultTimeZoneId?: string | null;
  postalCodePattern?: string | null;
  addressFormatHint?: string | null;
  sortOrder?: number | null;
  notes?: string | null;
}

export interface UpdateTimeZoneRequest {
  expectedVersion?: number;
  displayName?: string | null;
  shortName?: string | null;
  standardUtcOffsetMinutes?: number | null;
  supportsDaylightSaving?: boolean | null;
  daylightSavingRuleNote?: string | null;
  isDefaultRecommended?: boolean | null;
  sortOrder?: number | null;
  notes?: string | null;
}

export interface UpdateUserRequest {
  expectedVersion?: number;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  employeeNumber?: string | null;
  mobileCountryCode?: string | null;
  mobileNumber?: string | null;
  accountCategory?: UserAccountCategory;
  engagementType?: EngagementType;
  departmentId?: string | null;
  organisationUnitId?: string | null;
  designation?: string | null;
  managerUserId?: string | null;
  accessStartsAtUtc?: string | null;
  accessEndsAtUtc?: string | null;
  mfaRequirement?: MfaRequirement;
  joinedOn?: string | null;
  exitedOn?: string | null;
  preferredCulture?: string | null;
  timeZone?: string | null;
  avatarUrl?: string | null;
  reason?: string | null;
  title?: string | null;
  preferredName?: string | null;
  workLocation?: string | null;
}

export interface UpsertPaymentGatewayConfigurationRequest {
  id?: string | null;
  tenantId?: string | null;
  provider?: PaymentGatewayProvider;
  environment?: PaymentGatewayEnvironment;
  displayName?: string | null;
  merchantId?: string | null;
  apiKey?: string | null;
  secretKey?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  subscribedEvents?: string[] | null;
  settlementCurrencyCode?: string | null;
  returnUrl?: string | null;
  paymentLinkValidityMinutes?: number;
  enabledMethods?: string[] | null;
  isActive?: boolean;
  notes?: string | null;
  expectedVersion?: number | null;
  reason?: string | null;
}

export interface UserAccessComparisonResponse {
  gained?: string[] | null;
  lost?: string[] | null;
  unchanged?: string[] | null;
  sensitiveGained?: string[] | null;
  requiresJustification?: boolean;
  segregationOfDutiesConflicts?: string[] | null;
}

export interface UserAccessComparisonResponseApiResponse {
  success?: boolean;
  data?: UserAccessComparisonResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface UserAccessPreviewResponse {
  userId?: string;
  displayName?: string | null;
  isSuperAdmin?: boolean;
  hasAllTenantPermissions?: boolean;
  roles?: UserRoleAssignmentResponse[] | null;
  permissionGroups?: PermissionGroupResponse[] | null;
  dataScopes?: UserDataScopeResponse[] | null;
  directClaims?: string[] | null;
  totalPermissionCount?: number;
  sensitivePermissionCount?: number;
}

export interface UserAccessPreviewResponseApiResponse {
  success?: boolean;
  data?: UserAccessPreviewResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface UserDataScopeResponse {
  id?: string;
  scopeType?: DataScopeType;
  scopeValue?: string | null;
  displayLabel?: string | null;
  isEffective?: boolean;
  grantedAtUtc?: string;
  effectiveFromUtc?: string;
  effectiveToUtc?: string | null;
}

export interface UserDetailResponse {
  id?: string;
  tenantId?: string | null;
  businessUnitId?: string;
  code?: string | null;
  employeeNumber?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  emailConfirmed?: boolean;
  emailConfirmedAtUtc?: string | null;
  username?: string | null;
  mobileCountryCode?: string | null;
  mobileNumber?: string | null;
  mobileConfirmed?: boolean;
  accountCategory?: UserAccountCategory;
  engagementType?: EngagementType;
  departmentId?: string | null;
  departmentName?: string | null;
  organisationUnitId?: string | null;
  organisationUnitName?: string | null;
  designation?: string | null;
  managerUserId?: string | null;
  managerName?: string | null;
  status?: UserStatus;
  statusDisplay?: string | null;
  accessStartsAtUtc?: string;
  accessEndsAtUtc?: string | null;
  mfaRequirement?: MfaRequirement;
  mfaEnabled?: boolean;
  privilegeLevel?: PrivilegeLevel;
  isSuperAdmin?: boolean;
  isTenantAdmin?: boolean;
  isSystemAccount?: boolean;
  mustChangePassword?: boolean;
  isLockedOut?: boolean;
  lockoutEndUtc?: string | null;
  lockoutReason?: string | null;
  accessFailedCount?: number;
  lastLoginAtUtc?: string | null;
  lastLoginIpAddress?: string | null;
  lastLoginClientType?: ClientType;
  lastLoginBrowser?: string | null;
  lastLoginOperatingSystem?: string | null;
  joinedOn?: string | null;
  exitedOn?: string | null;
  preferredCulture?: string | null;
  timeZone?: string | null;
  avatarUrl?: string | null;
  createdAtUtc?: string;
  createdByUserId?: string;
  updatedAtUtc?: string | null;
  updatedByUserId?: string | null;
  version?: number;
  roles?: UserRoleAssignmentResponse[] | null;
  dataScopes?: UserDataScopeResponse[] | null;
  emailMasked?: boolean;
  mobileMasked?: boolean;
  hasPendingInvitation?: boolean;
  invitationExpiresAtUtc?: string | null;
  permittedActions?: string[] | null;
  title?: string | null;
  preferredName?: string | null;
  workLocation?: string | null;
}

export interface UserDetailResponseApiResponse {
  success?: boolean;
  data?: UserDetailResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface UserLifecycleRequest {
  reason?: string | null;
  expectedVersion?: number;
}

export interface UserListItemResponse {
  id?: string;
  code?: string | null;
  displayName?: string | null;
  email?: string | null;
  username?: string | null;
  status?: UserStatus;
  statusDisplay?: string | null;
  accountCategory?: UserAccountCategory;
  departmentName?: string | null;
  organisationUnitName?: string | null;
  designation?: string | null;
  roleNames?: string[] | null;
  mfaEnabled?: boolean;
  isLockedOut?: boolean;
  lastLoginAtUtc?: string | null;
  accessEndsAtUtc?: string | null;
  avatarUrl?: string | null;
  updatedAtUtc?: string;
  version?: number;
}

export interface UserListItemResponsePagedResponse {
  items?: UserListItemResponse[] | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

export interface UserListItemResponsePagedResponseApiResponse {
  success?: boolean;
  data?: UserListItemResponsePagedResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface UserLookupResponse {
  id?: string;
  code?: string | null;
  displayName?: string | null;
  email?: string | null;
  status?: UserStatus;
}

export interface UserLookupResponseIReadOnlyListApiResponse {
  success?: boolean;
  data?: UserLookupResponse[] | null;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface UserRoleAssignmentResponse {
  id?: string;
  roleId?: string;
  roleCode?: string | null;
  roleName?: string | null;
  status?: UserRoleAssignmentStatus;
  isPrimary?: boolean;
  isEffective?: boolean;
  assignedAtUtc?: string;
  assignedByName?: string | null;
  effectiveFromUtc?: string;
  effectiveToUtc?: string | null;
  justification?: string | null;
  permissionCount?: number;
}

export interface UserSecurityResponse {
  userId?: string;
  displayName?: string | null;
  mfaEnabled?: boolean;
  mfaRequirement?: MfaRequirement;
  isMfaEffectivelyRequired?: boolean;
  mfaEnrolledAtUtc?: string | null;
  recoveryCodesRemaining?: number;
  isLockedOut?: boolean;
  lockoutEndUtc?: string | null;
  lockoutReason?: string | null;
  accessFailedCount?: number;
  attemptsRemaining?: number;
  passwordChangedAtUtc?: string | null;
  mustChangePassword?: boolean;
  activeSessions?: UserSessionResponse[] | null;
  trustedDevices?: TrustedDeviceResponse[] | null;
  mfaMethods?: MfaMethodResponse[] | null;
  recentAttempts?: SignInAttemptResponse[] | null;
}

export interface UserSecurityResponseApiResponse {
  success?: boolean;
  data?: UserSecurityResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface UserSessionResponse {
  id?: string;
  deviceName?: string | null;
  clientType?: ClientType;
  browser?: string | null;
  operatingSystem?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  issuedAtUtc?: string;
  lastActivityAtUtc?: string;
  expiresAtUtc?: string;
  mfaCompleted?: boolean;
  isTrustedDevice?: boolean;
  isCurrent?: boolean;
  operatingTenantId?: string | null;
  operatingTenantName?: string | null;
}

export interface UserStatisticsResponse {
  total?: number;
  active?: number;
  invited?: number;
  suspended?: number;
  deactivated?: number;
  lockedOut?: number;
  mfaEnabled?: number;
  neverSignedIn?: number;
  accessExpiringSoon?: number;
  byStatus?: Record<string, number> | null;
}

export interface UserStatisticsResponseApiResponse {
  success?: boolean;
  data?: UserStatisticsResponse;
  message?: string | null;
  errorCode?: string | null;
  errors?: ValidationError[] | null;
  correlationId?: string | null;
}

export interface ValidationError {
  field?: string | null;
  message?: string | null;
}

export interface VerifyInvitationMfaEnrolmentRequest {
  token?: string | null;
  methodId?: string;
  code?: string | null;
}

export interface VerifyLoginIdentifierChangeRequest {
  requestId?: string;
  code?: string | null;
}

export interface VerifyMfaRequest {
  challengeToken?: string | null;
  code?: string | null;
  trustThisDevice?: boolean;
  deviceName?: string | null;
  deviceIdentifier?: string | null;
  clientType?: ClientType;
}

export interface VerifyOrganisationDomainRequest {
  domainId?: string;
}

export interface WithdrawAccessRequestRequest {
  reason?: string | null;
  expectedVersion?: number;
}
