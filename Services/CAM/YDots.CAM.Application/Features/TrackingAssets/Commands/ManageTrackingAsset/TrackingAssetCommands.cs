using Microsoft.Extensions.Logging;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Features.TrackingAssets.DTOs;
using YDots.CAM.Application.Features.TrackingAssets.Mappings;
using YDots.CAM.Domain.Entities;
using YDots.CAM.Domain.Enums;

namespace YDots.CAM.Application.Features.TrackingAssets.Commands.ManageTrackingAsset;

/// <summary>Creates a tracking asset against a campaign.</summary>
public sealed record CreateTrackingAssetCommand(CreateTrackingAssetRequest Request);

/// <summary>Creates one offline QR code per place, all in one save.</summary>
public sealed record CreatePlaceTrackingAssetsCommand(CreatePlaceTrackingAssetsRequest Request);

/// <summary>Edits a Draft tracking asset.</summary>
public sealed record UpdateTrackingAssetCommand(Guid TrackingAssetId, UpdateTrackingAssetRequest Request);

/// <summary>Draft to Submitted.</summary>
public sealed record SubmitTrackingAssetCommand(Guid TrackingAssetId, TrackingAssetLifecycleRequest Request);

/// <summary>Submitted to Approved. Refused for the person who created or submitted it.</summary>
public sealed record ApproveTrackingAssetCommand(Guid TrackingAssetId, TrackingAssetLifecycleRequest Request);

/// <summary>Approved to Active. This is where the tracking reference and URL are minted.</summary>
public sealed record ActivateTrackingAssetCommand(Guid TrackingAssetId, TrackingAssetLifecycleRequest Request);

/// <summary>Active to DisableRequested - the maker asking for a live asset to be taken down.</summary>
public sealed record RequestDisableTrackingAssetCommand(
    Guid TrackingAssetId, TrackingAssetLifecycleRequest Request);

/// <summary>Active or DisableRequested to Inactive - the checker's decision.</summary>
public sealed record DeactivateTrackingAssetCommand(Guid TrackingAssetId, TrackingAssetLifecycleRequest Request);

/// <summary>Destroys an unused Draft asset. The one delete in the module.</summary>
public sealed record DeleteDraftTrackingAssetCommand(
    Guid TrackingAssetId, TrackingAssetLifecycleRequest Request);

/// <summary>
/// Tracking asset creation, editing and lifecycle.
///
/// THE PLACEMENT RULE IS THE ONE WORTH KNOWING. Placements describe where a physical asset was
/// put - a poster in a hall, a card on a table - so they are required for an OFFLINE channel
/// and meaningless for any other. The old code identified that channel by a hard-coded seed
/// GUID; it is now keyed on the channel's <c>Code</c>, which survives a reseed and reads as
/// what it means.
///
/// THE TRACKING REFERENCE IS MINTED ON ACTIVATION, not on creation, and the timing matters. It
/// is the attribution key a donation carries back, and minting it for a draft that is later
/// abandoned would put a live-looking reference into the world for an asset that never
/// existed. Once minted it is never regenerated, because a QR code carrying it may already be
/// printed.
/// </summary>
public sealed class TrackingAssetCommandHandler(
    ITrackingAssetRepository assets,
    ICampaignRepository campaigns,
    IReferenceDataRepository referenceData,
    ITrackingReferenceGenerator references,
    IAuditWriter audit,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IDateTimeProvider clock,
    IUnitOfWork unitOfWork,
    ILogger<TrackingAssetCommandHandler> logger)
{
    /// <summary>The channel code that means "this asset exists in the physical world".</summary>
    private const string OfflineChannelCode = "OFFLINE";

    /// <summary>
    /// The source and medium a printed place QR code is attributed to when the caller names none -
    /// the pair the reference catalogue holds for a printed code, and the one the demonstration
    /// catalogue gives every offline QR code.
    /// </summary>
    private const string PrintedQrSourceCode = "QR_POSTER";
    private const string PrintedQrMediumCode = "PRINT";

    /// <summary>How many times a reference collision is retried before giving up.</summary>
    private const int ReferenceAttempts = 5;

    public async Task<Result<TrackingAssetDetailResponse>> HandleAsync(
        CreateTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        var request = command.Request;

        logger.LogInformation("Creating tracking asset for campaign {CampaignId}. AssetType: {AssetType}.", request.CampaignId, request.AssetType);

        if (!tenantContext.HasTenant)
        {
            logger.LogWarning("Tracking asset creation denied because no tenant is selected.");
            return Result.Failure<TrackingAssetDetailResponse>(Error.TenantSelectionRequired());
        }

        var campaign = await campaigns.GetByIdAsync(request.CampaignId, cancellationToken);
        if (campaign is null)
        {
            logger.LogWarning("Tracking asset creation failed because campaign {CampaignId} was not found.", request.CampaignId);
            return Result.Failure<TrackingAssetDetailResponse>(
                Error.NotFound("That campaign was not found."));
        }

        var context = await ResolveReferenceDataAsync(
            request.ChannelId, request.SourceId, request.MediumId, cancellationToken);

        if (context.IsFailure)
        {
            logger.LogWarning("Tracking asset creation failed while resolving reference data for campaign {CampaignId}.", request.CampaignId);
            return Result.Failure<TrackingAssetDetailResponse>(context.Error!);
        }

        var places = WithCampaignGeography(campaign, request.Places);

        var placementCheck = ValidatePlacements(
            request.AssetType, context.Value!.ChannelCode, places?.Count ?? 0);

        if (placementCheck.IsFailure)
        {
            logger.LogWarning("Tracking asset creation failed placement validation for campaign {CampaignId}.", request.CampaignId);
            return Result.Failure<TrackingAssetDetailResponse>(placementCheck.Error!);
        }

        if (request.ActiveTo <= request.ActiveFrom)
        {
            logger.LogWarning("Tracking asset creation failed because the active window is invalid for campaign {CampaignId}.", request.CampaignId);
            return Result.Failure<TrackingAssetDetailResponse>(Error.Validation(
                "The active window is not valid.",
                [new ValidationError(
                    nameof(request.ActiveTo), "The end of the window must be after its start.")]));
        }

        // Numbered and written under the campaign's code lock - see CodeLockKey.
        await using var serialised = await unitOfWork.BeginSerialisedAsync(
            CodeLockKey(campaign), cancellationToken);

        var code = await BuildCodeAsync(
            campaign, request.AssetType, new HashSet<string>(StringComparer.OrdinalIgnoreCase), cancellationToken);

        var asset = (request with { Places = places }).ToEntity(campaign, code);

        // STAMP THE SUBMITTER WHEN THE FORM CREATES A SUBMITTED ASSET.
        //
        // The Generate form offers "Asset status: Draft or Submitted", and the validator allows
        // both - but only the separate Submit endpoint was recording WHO submitted. A create with
        // Status = Submitted therefore reached the database with submitted_by_user_id NULL, which
        // is precisely what `ck_cam_tracking_assets_submitted` forbids, so every such create came
        // back as a bare DbUpdateException with no usable message on the screen.
        //
        // The stamp belongs here rather than in the mapping because who is acting and what time
        // it is are the handler's to know, and because a submission with no submitter is not a
        // row worth writing: the segregation-of-duties check on approval reads this field.
        if (asset.Status != TrackingAssetStatus.Draft)
        {
            asset.SubmittedByUserId = currentUser.UserId;
            asset.SubmittedAtUtc = clock.UtcNow;
        }

        await assets.AddAsync(asset, cancellationToken);

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.Created, nameof(TrackingAsset), asset.Id,
            cancellationToken: cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        await serialised.CommitAsync(cancellationToken);

        logger.LogInformation("Tracking asset {AssetId} created for campaign {CampaignId}.", asset.Id, request.CampaignId);

        return asset.ToDetailResponse(
            campaign.Code, campaign.Name,
            context.Value.ChannelName, context.Value.SourceName, context.Value.MediumName,
            clock.UtcNow,
            TrackingAssetMappingConfig.PermittedActionsFor(asset, currentUser.HasPermission));
    }

    /// <summary>
    /// Creates the QR codes of an offline event: one asset per place, written together.
    ///
    /// ALL OR NONE. Every place is checked before anything is added, the codes are numbered in one
    /// pass (each skipping the ones already given out in this request), and one save writes the
    /// lot. A refusal therefore leaves no half-saved event behind, and pressing Submit again
    /// cannot save a place twice.
    /// </summary>
    public async Task<Result<IReadOnlyList<TrackingAssetDetailResponse>>> HandleAsync(
        CreatePlaceTrackingAssetsCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        var request = command.Request;

        logger.LogInformation(
            "Creating {PlaceCount} place tracking assets for campaign {CampaignId}.",
            request.Places.Count, request.CampaignId);

        if (!tenantContext.HasTenant)
        {
            logger.LogWarning("Place tracking asset creation denied because no tenant is selected.");
            return Result.Failure<IReadOnlyList<TrackingAssetDetailResponse>>(Error.TenantSelectionRequired());
        }

        var campaign = await campaigns.GetByIdAsync(request.CampaignId, cancellationToken);
        if (campaign is null)
        {
            logger.LogWarning("Place tracking asset creation failed because campaign {CampaignId} was not found.", request.CampaignId);
            return Result.Failure<IReadOnlyList<TrackingAssetDetailResponse>>(
                Error.NotFound("That campaign was not found."));
        }

        var attribution = await ResolvePrintedAttributionAsync(request, cancellationToken);
        if (attribution.IsFailure)
        {
            return Result.Failure<IReadOnlyList<TrackingAssetDetailResponse>>(attribution.Error!);
        }

        var (sourceId, mediumId) = attribution.Value;

        var context = await ResolveReferenceDataAsync(
            request.ChannelId, sourceId, mediumId, cancellationToken);

        if (context.IsFailure)
        {
            logger.LogWarning("Place tracking asset creation failed while resolving reference data for campaign {CampaignId}.", request.CampaignId);
            return Result.Failure<IReadOnlyList<TrackingAssetDetailResponse>>(context.Error!);
        }

        // The channel has to be Offline: a place is where a printed code was put.
        var placementCheck = ValidatePlacements(
            TrackingAssetType.QRCode, context.Value!.ChannelCode, request.Places.Count);

        if (placementCheck.IsFailure)
        {
            logger.LogWarning("Place tracking asset creation failed placement validation for campaign {CampaignId}.", request.CampaignId);
            return Result.Failure<IReadOnlyList<TrackingAssetDetailResponse>>(placementCheck.Error!);
        }

        if (request.ActiveTo <= request.ActiveFrom)
        {
            logger.LogWarning("Place tracking asset creation failed because the active window is invalid for campaign {CampaignId}.", request.CampaignId);
            return Result.Failure<IReadOnlyList<TrackingAssetDetailResponse>>(Error.Validation(
                "The active window is not valid.",
                [new ValidationError(
                    nameof(request.ActiveTo), "The end of the window must be after its start.")]));
        }

        var places = WithCampaignGeography(campaign, request.Places)!;

        // Every place is numbered and written under the campaign's code lock - see CodeLockKey.
        await using var serialised = await unitOfWork.BeginSerialisedAsync(
            CodeLockKey(campaign), cancellationToken);

        var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var created = new List<TrackingAsset>(places.Count);

        foreach (var place in places)
        {
            var code = await BuildCodeAsync(campaign, TrackingAssetType.QRCode, reserved, cancellationToken);
            reserved.Add(code);

            // The asset's own destination is its place's: it is what the place's QR code opens.
            var asset = new CreateTrackingAssetRequest(
                    request.CampaignId,
                    TrackingAssetType.QRCode,
                    request.ChannelId,
                    place.Destination,
                    sourceId,
                    mediumId,
                    request.Status,
                    request.ActiveFrom,
                    request.ActiveTo,
                    request.ContentTag,
                    [place])
                .ToEntity(campaign, code);

            // Stamped here for the same reason as on a single create - see that handler.
            if (asset.Status != TrackingAssetStatus.Draft)
            {
                asset.SubmittedByUserId = currentUser.UserId;
                asset.SubmittedAtUtc = clock.UtcNow;
            }

            await assets.AddAsync(asset, cancellationToken);

            await audit.WriteAsync(
                TrackingAssetAuditActionCodes.Created, nameof(TrackingAsset), asset.Id,
                cancellationToken: cancellationToken);

            created.Add(asset);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        await serialised.CommitAsync(cancellationToken);

        logger.LogInformation(
            "Created {PlaceCount} place tracking assets ({Codes}) for campaign {CampaignId}.",
            created.Count, string.Join(", ", created.Select(asset => asset.Code)), request.CampaignId);

        var now = clock.UtcNow;

        return Result.Success<IReadOnlyList<TrackingAssetDetailResponse>>([.. created
            .Select(asset => asset.ToDetailResponse(
                campaign.Code, campaign.Name,
                context.Value.ChannelName, context.Value.SourceName, context.Value.MediumName,
                now,
                TrackingAssetMappingConfig.PermittedActionsFor(asset, currentUser.HasPermission)))]);
    }

    public async Task<Result<OutcomeResponse>> HandleAsync(
        UpdateTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        var request = command.Request;

        logger.LogInformation("Updating tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(command.TrackingAssetId, request.ExpectedVersion, cancellationToken);
        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} update failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        // ONLY A DRAFT MAY BE EDITED. Past that an approver has seen it, and changing the
        // destination underneath them would make the approval meaningless - the destination is
        // the whole thing being approved.
        if (asset.Status != TrackingAssetStatus.Draft)
        {
            logger.LogWarning("Tracking asset {AssetId} update rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                $"Only a Draft tracking asset can be edited. This one is {asset.Status}."));
        }

        var context = await ResolveReferenceDataAsync(
            request.ChannelId, request.SourceId, request.MediumId, cancellationToken);

        if (context.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} update failed while resolving reference data.", asset.Id);
            return Result.Failure<OutcomeResponse>(context.Error!);
        }

        var owningCampaign = await campaigns.GetByIdAsync(asset.CampaignId, cancellationToken);

        var places = owningCampaign is null
            ? request.Places
            : WithCampaignGeography(owningCampaign, request.Places);

        // PLACES THE REQUEST LEAVES OUT ARE KEPT, so they are what gets checked. The edit form
        // sends none, and checking an empty list refused every edit of an offline QR code with
        // "needs at least one place" - for an asset that had one.
        var placementCheck = ValidatePlacements(
            request.AssetType,
            context.Value!.ChannelCode,
            places?.Count ?? asset.Places.Count);

        if (placementCheck.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} update failed placement validation.", asset.Id);
            return Result.Failure<OutcomeResponse>(placementCheck.Error!);
        }

        if (request.ActiveTo <= request.ActiveFrom)
        {
            logger.LogWarning("Tracking asset {AssetId} update failed because the active window is invalid.", asset.Id);
            return Result.Failure<OutcomeResponse>(Error.Validation(
                "The active window is not valid.",
                [new ValidationError(
                    nameof(request.ActiveTo), "The end of the window must be after its start.")]));
        }

        (request with { Places = places }).ApplyTo(asset);

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.Updated, nameof(TrackingAsset), asset.Id,
            cancellationToken: cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Tracking asset {AssetId} updated successfully.", asset.Id);

        return BuildOutcome(asset, "Tracking asset updated.");
    }

    public async Task<Result<OutcomeResponse>> HandleAsync(
        SubmitTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Submitting tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(
            command.TrackingAssetId, command.Request.ExpectedVersion, cancellationToken);

        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} operation failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        if (asset.Status != TrackingAssetStatus.Draft)
        {
            logger.LogWarning("Tracking asset {AssetId} submission rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                $"Only a Draft tracking asset can be submitted. This one is {asset.Status}."));
        }

        asset.Status = TrackingAssetStatus.Submitted;
        asset.SubmittedByUserId = currentUser.UserId;
        asset.SubmittedAtUtc = clock.UtcNow;

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.Submitted, nameof(TrackingAsset), asset.Id,
            command.Request.Reason, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Tracking asset {AssetId} submitted for approval.", asset.Id);

        return BuildOutcome(asset, "Tracking asset submitted for approval.");
    }

    public async Task<Result<OutcomeResponse>> HandleAsync(
        ApproveTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Approving tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(
            command.TrackingAssetId, command.Request.ExpectedVersion, cancellationToken);

        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} operation failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        if (asset.Status != TrackingAssetStatus.Submitted)
        {
            logger.LogWarning("Tracking asset {AssetId} approval rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                $"Only a Submitted tracking asset can be approved. This one is {asset.Status}."));
        }

        // No test of who created or submitted it: the permission decides, as for campaigns.
        asset.Status = TrackingAssetStatus.Approved;
        asset.ApprovedByUserId = currentUser.UserId;
        asset.ApprovedAtUtc = clock.UtcNow;

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.Approved, nameof(TrackingAsset), asset.Id,
            command.Request.Reason, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Tracking asset {AssetId} approved.", asset.Id);

        return BuildOutcome(asset, "Tracking asset approved.");
    }

    /// <summary>
    /// Approved to Active, minting the tracking reference and the generated URL.
    ///
    /// THE REFERENCE IS MINTED ONCE AND NEVER AGAIN. An asset deactivated and reactivated keeps
    /// the reference it already had, because a QR code carrying it may be printed on a thousand
    /// leaflets - regenerating would silently orphan every one of them.
    /// </summary>
    public async Task<Result<OutcomeResponse>> HandleAsync(
        ActivateTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Activating tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(
            command.TrackingAssetId, command.Request.ExpectedVersion, cancellationToken);

        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} operation failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        if (asset.Status != TrackingAssetStatus.Approved)
        {
            logger.LogWarning("Tracking asset {AssetId} activation rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                $"Only an Approved tracking asset can be activated. This one is {asset.Status}."));
        }

        var now = clock.UtcNow;

        if (asset.ActiveTo <= now)
        {
            logger.LogWarning("Tracking asset {AssetId} activation rejected because its active window has closed.", asset.Id);
            return Result.Failure<OutcomeResponse>(Error.TrackingAssetNotLive(
                $"This asset's window closed on {asset.ActiveTo:yyyy-MM-dd}. Extend it before activating."));
        }

        if (string.IsNullOrWhiteSpace(asset.TrackingReference))
        {
            var minted = await MintReferenceAsync(cancellationToken);

            if (minted.IsFailure)
            {
                return Result.Failure<OutcomeResponse>(minted.Error!);
            }

            asset.TrackingReference = minted.Value;

            var campaign = await campaigns.GetByIdAsync(asset.CampaignId, cancellationToken);
            var context = await ResolveReferenceDataAsync(
                asset.ChannelId, asset.SourceId, asset.MediumId, cancellationToken);

            if (campaign is not null && context.IsSuccess)
            {
                asset.GeneratedUrl = references.BuildUrl(
                    asset, context.Value!.SourceCode, context.Value.MediumCode, campaign.Code);
            }
        }

        asset.Status = TrackingAssetStatus.Active;

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.Activated, nameof(TrackingAsset), asset.Id,
            command.Request.Reason, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Tracking asset {AssetId} activated with reference {Reference}.",
            asset.Id, asset.TrackingReference);

        return BuildOutcome(asset, "Tracking asset activated.");
    }

    /// <summary>
    /// Asks for a live asset to be taken down: Active to DisableRequested.
    ///
    /// THE ASSET GOES ON RESOLVING. `IsLiveAt` tests for Active, so a pending request does not
    /// stop a scan on its own - and it must not, because until somebody decides the request the
    /// printed QR code in the world is still the campaign's. What changes is that the asset is
    /// now visibly awaiting a decision, and an approver has something to decide.
    /// </summary>
    public async Task<Result<OutcomeResponse>> HandleAsync(
        RequestDisableTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Requesting disable for tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(
            command.TrackingAssetId, command.Request.ExpectedVersion, cancellationToken);

        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} operation failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        if (asset.Status != TrackingAssetStatus.Active)
        {
            logger.LogWarning("Tracking asset {AssetId} disable request rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                $"Only an Active tracking asset can be requested for disable. This one is {asset.Status}."));
        }

        asset.Status = TrackingAssetStatus.DisableRequested;

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.DisableRequested, nameof(TrackingAsset), asset.Id,
            command.Request.Reason, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Disable requested for tracking asset {AssetId}.", asset.Id);

        return BuildOutcome(asset, "Disable requested. An approver must decide it.");
    }

    /// <summary>
    /// Takes an asset down: Active or DisableRequested to Inactive.
    ///
    /// BOTH SOURCE STATES ARE ACCEPTED. Deciding a maker's request is the ordinary path, and a
    /// checker who can see the asset should not have to ask themselves for permission first when
    /// something has to come down now.
    /// </summary>
    public async Task<Result<OutcomeResponse>> HandleAsync(
        DeactivateTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Deactivating tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(
            command.TrackingAssetId, command.Request.ExpectedVersion, cancellationToken);

        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} operation failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        if (asset.Status is not (TrackingAssetStatus.Active or TrackingAssetStatus.DisableRequested))
        {
            logger.LogWarning("Tracking asset {AssetId} deactivation rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                "Only an Active tracking asset, or one with a disable request on it, can be "
                + $"deactivated. This one is {asset.Status}."));
        }

        asset.Status = TrackingAssetStatus.Inactive;

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.Deactivated, nameof(TrackingAsset), asset.Id,
            command.Request.Reason, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Tracking asset {AssetId} deactivated.", asset.Id);

        return BuildOutcome(asset, "Tracking asset deactivated.");
    }

    /// <summary>
    /// Destroys an unused Draft asset.
    ///
    /// DRAFT ONLY, AND ONLY WITH NOTHING POINTING AT IT. A draft has never been activated, so it
    /// holds no tracking reference and no donation can have been attributed through it - which is
    /// the whole reason this one delete is safe when no other is. `UsageCount` is checked as well
    /// as the status, so an asset that has somehow taken traffic survives regardless.
    ///
    /// THE AUDIT ROW IS WRITTEN BEFORE THE ROW GOES, and it outlives it.
    /// </summary>
    public async Task<Result<OutcomeResponse>> HandleAsync(
        DeleteDraftTrackingAssetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Deleting draft tracking asset {AssetId}.", command.TrackingAssetId);

        var loaded = await LoadAsync(
            command.TrackingAssetId, command.Request.ExpectedVersion, cancellationToken);

        if (loaded.IsFailure)
        {
            logger.LogWarning("Tracking asset {AssetId} operation failed while loading the asset.", command.TrackingAssetId);
            return Result.Failure<OutcomeResponse>(loaded.Error!);
        }

        var asset = loaded.Value!;

        if (asset.Status != TrackingAssetStatus.Draft)
        {
            logger.LogWarning("Tracking asset {AssetId} deletion rejected because its status is {Status}.", asset.Id, asset.Status);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                $"Only a Draft tracking asset can be deleted. This one is {asset.Status}. "
                + "An asset that has been approved is retired by deactivating it, so the "
                + "donations attributed through it keep resolving."));
        }

        if (asset.UsageCount > 0)
        {
            logger.LogWarning("Draft tracking asset {AssetId} deletion rejected because it has usage.", asset.Id);
            return Result.Failure<OutcomeResponse>(Error.InvalidTransition(
                "This draft has recorded usage, so something already points at it. It cannot be "
                + "deleted."));
        }

        await audit.WriteAsync(
            TrackingAssetAuditActionCodes.DraftDeleted, nameof(TrackingAsset), asset.Id,
            command.Request.Reason, cancellationToken);

        // The outcome is built from the asset while it is still readable; the row goes on save.
        var outcome = BuildOutcome(asset, "Draft tracking asset deleted.");

        assets.Remove(asset);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Draft tracking asset {AssetId} deleted.", asset.Id);

        return outcome;
    }

    // =====================================================================================
    // Shared
    // =====================================================================================

    private async Task<Result<TrackingAsset>> LoadAsync(
        Guid assetId, long expectedVersion, CancellationToken cancellationToken)
    {
        var asset = await assets.GetByIdAsync(assetId, cancellationToken);

        if (asset is null)
        {
            logger.LogWarning("Tracking asset {AssetId} was not found.", assetId);
            return Result.Failure<TrackingAsset>(Error.NotFound("That tracking asset was not found."));
        }

        if (asset.Version != expectedVersion)
        {
            logger.LogWarning("Tracking asset {AssetId} version conflict. Expected: {ExpectedVersion}, Actual: {ActualVersion}.", assetId, expectedVersion, asset.Version);
            return Result.Failure<TrackingAsset>(Error.Concurrency());
        }

        return asset;
    }

    /// <summary>
    /// Loads the channel, source and medium together and confirms all three exist.
    ///
    /// One trip rather than three separate existence checks, and it returns the NAMES as well
    /// so the response can be built without a second round of lookups.
    /// </summary>
    private async Task<Result<ReferenceContext>> ResolveReferenceDataAsync(
        Guid channelId, Guid sourceId, Guid mediumId, CancellationToken cancellationToken)
    {
        var channel = await referenceData.GetChannelAsync(channelId, cancellationToken);
        if (channel is null)
        {
            logger.LogWarning("Tracking asset reference data channel {ChannelId} was not found.", channelId);
            return Result.Failure<ReferenceContext>(Error.NotFound("That channel was not found."));
        }

        var source = await referenceData.GetSourceAsync(sourceId, cancellationToken);
        if (source is null)
        {
            logger.LogWarning("Tracking asset reference data source {SourceId} was not found.", sourceId);
            return Result.Failure<ReferenceContext>(Error.NotFound("That source was not found."));
        }

        var medium = await referenceData.GetMediumAsync(mediumId, cancellationToken);
        if (medium is null)
        {
            logger.LogWarning("Tracking asset reference data medium {MediumId} was not found.", mediumId);
            return Result.Failure<ReferenceContext>(Error.NotFound("That medium was not found."));
        }

        return new ReferenceContext(
            channel.Code, channel.Name, source.Code, source.Name, medium.Code, medium.Name);
    }

    /// <summary>
    /// Placements belong to an Offline asset and to nothing else.
    ///
    /// Both directions are refused, which is the part worth noticing: an Offline asset with no
    /// placement cannot report where a gift came from, and a placement on an e-mail asset is a
    /// row that will never mean anything and will confuse whoever reads it next.
    /// </summary>
    /// <summary>
    /// Whether this asset is the kind that has physical placements: a QR code, on the OFFLINE
    /// channel.
    ///
    /// BOTH HALVES MATTER, and only one of them used to. The rule keyed on the channel alone, so
    /// a short link on the offline channel was REFUSED unless somebody invented placements for
    /// it - and a placement describes where a printed thing was put, which a link does not have.
    /// The Generate asset form draws it the way the module brief states it: the Places section
    /// appears when asset type is QR Code and channel is Offline, and not otherwise.
    /// </summary>
    private static bool HasPlacements(TrackingAssetType assetType, string channelCode) =>
        assetType == TrackingAssetType.QRCode
        && string.Equals(channelCode, OfflineChannelCode, StringComparison.OrdinalIgnoreCase);

    private static Result ValidatePlacements(
        TrackingAssetType assetType,
        string channelCode,
        int count)
    {
        var expectsPlacements = HasPlacements(assetType, channelCode);

        if (expectsPlacements && count == 0)
        {
            return Result.Failure(Error.Validation(
                "An offline QR code needs at least one place.",
                [new ValidationError("places", "Add the place where this QR code will appear.")]));
        }

        if (!expectsPlacements && count > 0)
        {
            return Result.Failure(Error.Validation(
                "Places apply to an offline QR code only.",
                [new ValidationError(
                    "places",
                    "Remove the places, or set the asset type to QR Code and the channel to Offline.")]));
        }

        return Result.Success();
    }

    /// <summary>
    /// Fills a placement's city and state from the campaign where the caller left them blank.
    ///
    /// THE FORM PROMISES THIS. Both fields render as "From campaign" and are not editable, so
    /// the client has nothing to send - and before this the server stored exactly what it was
    /// sent, which was nothing. Every offline placement was saved with no location, and the
    /// place-level reporting the QR codes exist to produce had nothing to group by.
    ///
    /// AN EXPLICIT VALUE IS RESPECTED. A campaign can legitimately run an event outside its own
    /// city, and an importer that knows better should not have its answer overwritten.
    /// </summary>
    private static IReadOnlyList<TrackingAssetPlaceRequest>? WithCampaignGeography(
        Campaign campaign, IReadOnlyList<TrackingAssetPlaceRequest>? places)
    {
        if (places is null || places.Count == 0)
        {
            return places;
        }

        return [.. places.Select(place => place with
        {
            CityId = place.CityId ?? campaign.CityId,
            StateId = place.StateId ?? campaign.StateId
        })];
    }

    /// <summary>
    /// The source and medium a place QR code is attributed to: the caller's, or the printed pair.
    ///
    /// The Generate form asks for neither, so it leaves both out, and the catalogue's own
    /// printed-code rows are used. Before this the form sent the first row of each list - Newsletter
    /// and E-mail - and every printed code carried utm_source=NEWSLETTER and utm_medium=EMAIL.
    /// </summary>
    private async Task<Result<(Guid SourceId, Guid MediumId)>> ResolvePrintedAttributionAsync(
        CreatePlaceTrackingAssetsRequest request, CancellationToken cancellationToken)
    {
        var sourceId = request.SourceId;
        var mediumId = request.MediumId;

        if (sourceId is null)
        {
            var source = await referenceData.GetSourceByCodeAsync(PrintedQrSourceCode, cancellationToken);
            if (source is null || !source.IsSelectable)
            {
                logger.LogWarning("Place tracking asset creation failed: source {SourceCode} is missing or retired.", PrintedQrSourceCode);
                return Result.Failure<(Guid, Guid)>(Error.Dependency(
                    "The \"QR Poster\" source is missing or retired in Master Data, so the QR codes "
                    + "cannot be attributed. Ask your administrator to restore it."));
            }

            sourceId = source.Id;
        }

        if (mediumId is null)
        {
            var medium = await referenceData.GetMediumByCodeAsync(PrintedQrMediumCode, cancellationToken);
            if (medium is null || !medium.IsSelectable)
            {
                logger.LogWarning("Place tracking asset creation failed: medium {MediumCode} is missing or retired.", PrintedQrMediumCode);
                return Result.Failure<(Guid, Guid)>(Error.Dependency(
                    "The \"Print\" medium is missing or retired in Master Data, so the QR codes "
                    + "cannot be attributed. Ask your administrator to restore it."));
            }

            mediumId = medium.Id;
        }

        return Result.Success((sourceId.Value, mediumId.Value));
    }

    /// <summary>
    /// The lock a campaign's asset codes are numbered under.
    ///
    /// THE RACE IT CLOSES. A code is numbered from how many assets the campaign has, so two
    /// requests that counted at the same moment picked the same number and the unique index
    /// refused the second save - which reached the person as "DbUpdateException: An error
    /// occurred while saving the entity changes". The Generate form made this the ordinary case:
    /// it sent one create per place card, in parallel. Under the lock the count, the numbering and
    /// the insert of one request finish before the next request counts.
    ///
    /// ONE CAMPAIGN AT A TIME, not the whole Organisation: codes start with the campaign's own
    /// code, so two campaigns can never produce the same one.
    /// </summary>
    private static string CodeLockKey(Campaign campaign) => $"cam.tracking-asset-code:{campaign.Id}";

    /// <summary>
    /// Builds a readable asset code: CAMP01-QR-003.
    ///
    /// The sequence comes from how many assets the campaign already has, so an operator scanning
    /// a list can tell one QR code from another without opening each to read its destination.
    /// <paramref name="reserved"/> holds the codes already given to other assets in the same
    /// request, which the database cannot see yet. Callers hold <see cref="CodeLockKey"/>, so no
    /// other request can number codes for the campaign in between.
    /// </summary>
    private async Task<string> BuildCodeAsync(
        Campaign campaign,
        TrackingAssetType assetType,
        IReadOnlySet<string> reserved,
        CancellationToken cancellationToken)
    {
        var existing = await assets.CountForCampaignAsync(campaign.Id, cancellationToken);

        var prefix = assetType switch
        {
            TrackingAssetType.QRCode => "QR",
            TrackingAssetType.ShortLink => "SL",
            TrackingAssetType.UTMLink => "UTM",
            TrackingAssetType.LandingPage => "LP",
            _ => "TA"
        };

        // Walks forward past any code already taken, which happens when a draft was deleted and
        // the count fell below the highest number in use.
        for (var sequence = existing + 1; sequence < existing + 100; sequence++)
        {
            var candidate = $"{campaign.Code}-{prefix}-{sequence:000}";

            if (!reserved.Contains(candidate)
                && !await assets.CodeExistsAsync(candidate, null, cancellationToken))
            {
                return candidate;
            }
        }

        // Unreachable in practice. A suffix guarantees an answer rather than looping forever.
        return $"{campaign.Code}-{prefix}-{Guid.NewGuid():N}"[..40];
    }

    /// <summary>
    /// Mints an unused tracking reference.
    ///
    /// Checked ACROSS Organisations, because a reference arrives from the public donation flow
    /// with no session to scope it - so a collision between two Organisations would credit one
    /// Organisation's gift to another.
    /// </summary>
    private async Task<Result<string>> MintReferenceAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < ReferenceAttempts; attempt++)
        {
            var candidate = references.NewReference();

            if (!await assets.TrackingReferenceExistsAsync(candidate, cancellationToken))
            {
                return candidate;
            }

            logger.LogWarning("Tracking reference collision on attempt {Attempt}. Retrying.", attempt + 1);
        }

        // Five collisions in a row against a random reference means the generator is broken, not
        // that we were unlucky. Reported as a dependency failure because the caller did nothing
        // wrong and a retry later may well work.
        return Result.Failure<string>(Error.Dependency(
            "A unique tracking reference could not be generated. Try again shortly."));
    }

    private OutcomeResponse BuildOutcome(TrackingAsset asset, string message) =>
        new(asset.Id,
            asset.Status.ToString(),
            asset.Version,
            message,
            TrackingAssetMappingConfig.PermittedActionsFor(asset, currentUser.HasPermission));

    /// <summary>The channel, source and medium resolved together, with their codes and names.</summary>
    private sealed record ReferenceContext(
        string ChannelCode,
        string ChannelName,
        string SourceCode,
        string SourceName,
        string MediumCode,
        string MediumName);
}
