using YDots.CAM.Application.Common.Models;

namespace YDots.CAM.Application.Features.WhatsApp.DTOs;

// =================================================================================================
// The controlled-sending workflow of the WhatsApp Messages page (/app/whatsapp/wati):
//
//   validated numbers (a check's Yes answers)  ->  filter and pick 10-50  ->  keep as a group
//   ->  choose and fill a template  ->  review what will happen  ->  send  ->  send log and exports
//
// Every list, count, filter option and permitted action comes from the server; the page holds only
// the person's current pick.
// =================================================================================================

// ---- 1. The selection pool ------------------------------------------------------------------------

/// <summary>Filters for the selection pool. Every one is optional and they combine.</summary>
public sealed class WatiRecipientFilter
{
    public int Page { get; set; } = 1;

    public int PageSize { get; set; } = 25;

    /// <summary>Part of a number, a name or a country.</summary>
    public string? Search { get; set; }

    /// <summary>Only the numbers this check (int_integration_jobs.id) found on WhatsApp - and offered from it.</summary>
    public Guid? JobId { get; set; }

    /// <summary>ISO-style country code shown on the screens, e.g. "IN".</summary>
    public string? Country { get; set; }

    /// <summary>Only members of this recipient group.</summary>
    public Guid? GroupId { get; set; }

    /// <summary>Only members of a group with this tag.</summary>
    public string? Tag { get; set; }

    /// <summary>any | never (never messaged by this organisation) | messaged (messaged at least once).</summary>
    public string? History { get; set; }
}

/// <summary>A page of the pool, with the options its filters offer.</summary>
public sealed record WatiRecipientSearchResponse(PagedResponse<WatiRecipientView> Results, WatiRecipientFacets Facets);

/// <summary>
/// What the pool's filters can be set to, each with how many numbers it holds. Computed over the
/// whole pool, so an option does not disappear because another filter is set.
/// </summary>
/// <param name="PoolSize">Every number of the organisation on WhatsApp, as the newest answers say.</param>
public sealed record WatiRecipientFacets(
    int PoolSize,
    IReadOnlyList<WatiJobFacet> Jobs,
    IReadOnlyList<WatiCountryFacet> Countries,
    IReadOnlyList<WatiGroupFacet> Groups,
    IReadOnlyList<WatiTagFacet> Tags,
    IReadOnlyList<WatiOptionFacet> Histories);

/// <param name="Count">Numbers this check found on WhatsApp that still are.</param>
public sealed record WatiJobFacet(Guid Id, string JobNumber, string FileName, int Count, DateTimeOffset CreatedAtUtc);

public sealed record WatiCountryFacet(string Iso, string Name, int Count);

/// <param name="Count">Members still in the pool (on WhatsApp now).</param>
public sealed record WatiGroupFacet(Guid Id, string Name, int Count);

/// <param name="Count">Distinct pool numbers in groups with this tag.</param>
public sealed record WatiTagFacet(string Tag, int Count);

/// <summary>A fixed option with its server-side label and count (the "messaging history" filter).</summary>
public sealed record WatiOptionFacet(string Value, string Label, int Count);

/// <summary>"Select all that match": the matching numbers up to the selection cap, each with its check.</summary>
/// <param name="TotalMatching">How many numbers matched in all.</param>
/// <param name="Limit">How many were returned at most (the room left under the cap).</param>
public sealed record WatiMatchingRecipients(IReadOnlyList<WatiSelectableRecipient> Recipients, int TotalMatching, int Limit);

public sealed record WatiSelectableRecipient(string Number, Guid JobId, string JobNumber, string? ContactName);

// ---- 2. Recipient groups --------------------------------------------------------------------------

/// <summary>One recipient group in the list.</summary>
/// <param name="MemberCount">Every number in the group.</param>
/// <param name="ReachableCount">Members a send can reach now (still on WhatsApp).</param>
/// <param name="PermittedActions">use, edit, delete - what the caller may do with it.</param>
public sealed record WhatsAppGroupView(
    Guid Id,
    string Name,
    string? Description,
    Guid? CampaignId,
    string? CampaignName,
    IReadOnlyList<string> Tags,
    int MemberCount,
    int ReachableCount,
    int SendCount,
    DateTimeOffset? LastSentAtUtc,
    DateTimeOffset CreatedAtUtc,
    string? CreatedByName,
    DateTimeOffset? UpdatedAtUtc,
    string? UpdatedByName,
    long Version,
    IReadOnlyList<string> PermittedActions);

/// <summary>A group with its members.</summary>
public sealed record WhatsAppGroupDetail(WhatsAppGroupView Group, IReadOnlyList<WhatsAppGroupMemberView> Members);

/// <param name="Reachable">Still a WhatsApp number of the organisation (the newest answer is Yes).</param>
public sealed record WhatsAppGroupMemberView(
    string Number,
    string? ContactName,
    Guid? SourceJobId,
    string? SourceJobNumber,
    DateTimeOffset AddedAtUtc,
    string? AddedByName,
    bool Reachable,
    DateTimeOffset? LastMessagedAtUtc);

/// <summary>A new group, usually made from the current selection.</summary>
public sealed record CreateWhatsAppGroupRequest(
    string Name,
    string? Description,
    Guid? CampaignId,
    IReadOnlyList<string>? Tags,
    IReadOnlyList<SelectedRecipientRequest>? Members);

/// <summary>New name, description, campaign or tags. <paramref name="ExpectedVersion"/> guards against overwriting somebody else's change.</summary>
public sealed record UpdateWhatsAppGroupRequest(
    string Name,
    string? Description,
    Guid? CampaignId,
    IReadOnlyList<string>? Tags,
    long ExpectedVersion);

public sealed record AddWhatsAppGroupMembersRequest(IReadOnlyList<SelectedRecipientRequest> Members);

public sealed record RemoveWhatsAppGroupMembersRequest(IReadOnlyList<string> Numbers);

/// <summary>What a membership change did.</summary>
/// <param name="NotInPool">Numbers left out because no check of the organisation has them on WhatsApp.</param>
public sealed record WhatsAppGroupChangeResponse(Guid GroupId, int Added, int AlreadyMembers, int NotInPool, int Removed, int MemberCount, string Message);

// ---- 3 and 4. Review before sending ----------------------------------------------------------------

/// <summary>
/// The send form as it stands, for the review. A type of its own so the strict send validator
/// does not run on it: the review REPORTS every problem (an empty value, a missing name) instead
/// of refusing the request, which is what the person needs while still filling the form in.
/// </summary>
public sealed record ReviewSendRequest(
    string? TemplateName,
    string? TemplateLabel,
    string? BroadcastName,
    IReadOnlyDictionary<string, string>? Values,
    IReadOnlyList<SelectedRecipientRequest>? Selection,
    Guid? CampaignId,
    Guid? RecipientGroupId,
    IReadOnlyList<string>? Tags,
    IReadOnlyList<ParameterBindingRequest>? Bindings)
{
    public SendBroadcastRequest ToSendRequest() =>
        new(TemplateName ?? string.Empty, TemplateLabel, BroadcastName ?? string.Empty, Values, null, CampaignId, Selection ?? [], RecipientGroupId, Tags, Bindings);
}

/// <summary>
/// What a send WOULD do, worked out from the same rules the worker applies - nothing is queued.
/// The one rule the server cannot apply number by number is the worker's test allow-list (it only
/// publishes that one is set and how long it is); <see cref="AllowListActive"/> says so.
/// </summary>
public sealed record SendReviewResponse(SendReviewSummary Summary, IReadOnlyList<SendReviewRecipient> Recipients);

/// <param name="Selected">Numbers selected.</param>
/// <param name="WillSend">Messages that will go to WATI.</param>
/// <param name="WillSkip">Message rows the worker will record as skipped, with the reason.</param>
/// <param name="Excluded">Selected numbers that will not become a message row at all.</param>
/// <param name="ByReason">Skipped and excluded, counted by reason code.</param>
/// <param name="Problems">Why the send cannot go as it is (an empty value, a selection over the cap). Empty when it can.</param>
public sealed record SendReviewSummary(
    int Selected,
    int WillSend,
    int WillSkip,
    int Excluded,
    IReadOnlyDictionary<string, int> ByReason,
    int MaxRecipientsPerSend,
    bool AllowListActive,
    int AllowListSize,
    string? TemplateLabel,
    string? HeaderFormat,
    string? MediaUrl,
    IReadOnlyList<string> Problems);

/// <param name="Outcome">send | skip | exclude.</param>
/// <param name="Reason">The worker's code (ALREADY_SENT, NOT_IN_POOL ...) when not "send".</param>
/// <param name="ReasonText">The same in words.</param>
/// <param name="RenderedText">The message as this recipient will read it.</param>
public sealed record SendReviewRecipient(
    string Number,
    string? ContactName,
    Guid? SourceJobId,
    string? SourceJobNumber,
    string Outcome,
    string? Reason,
    string? ReasonText,
    string? RenderedText,
    IReadOnlyDictionary<string, string> Values);

// ---- 5. The send log -------------------------------------------------------------------------------

/// <summary>Filters for the send log and its export.</summary>
public sealed class WatiBroadcastFilter
{
    public int Page { get; set; } = 1;

    public int PageSize { get; set; } = 25;

    /// <summary>Reference, send name, template or group.</summary>
    public string? Search { get; set; }

    /// <summary>queued | sending | completed | failed (Failed or CompletedWithErrors) | cancelled.</summary>
    public string? Status { get; set; }

    public string? TemplateName { get; set; }

    public Guid? GroupId { get; set; }

    public Guid? CampaignId { get; set; }

    /// <summary>Only sends that messaged numbers picked from this check.</summary>
    public Guid? JobId { get; set; }

    /// <summary>Created on or after this day (UTC).</summary>
    public DateTimeOffset? From { get; set; }

    /// <summary>Created before the end of this day (UTC).</summary>
    public DateTimeOffset? To { get; set; }
}

/// <summary>The send log's page, with the options its filters offer.</summary>
public sealed record WatiBroadcastSearchResponse(PagedResponse<WatiBroadcastView> Results, WatiBroadcastFacets Facets);

public sealed record WatiBroadcastFacets(
    IReadOnlyList<WatiOptionFacet> Statuses,
    IReadOnlyList<WatiOptionFacet> Templates,
    IReadOnlyList<WatiOptionFacet> Groups);

/// <summary>One send in full: what was chosen, how the template was filled, and what became of every number.</summary>
/// <param name="Values">The template values as sent (the fallback for bound parameters).</param>
/// <param name="Bindings">Parameters filled per recipient: parameter name -> source.</param>
/// <param name="TemplateBody">The template body as it was when the send was made.</param>
public sealed record WatiBroadcastDetail(
    WatiBroadcastView Broadcast,
    IReadOnlyDictionary<string, string> Values,
    IReadOnlyDictionary<string, string> Bindings,
    string? TemplateBody,
    string? RenderedPreview,
    IReadOnlyList<WatiBroadcastRecipientView> Recipients,
    IReadOnlyList<JobEventView> Events);

/// <summary>One selected number of a send and what became of it.</summary>
/// <param name="Status">PENDING | SENT | DELIVERED | READ | REPLIED | FAILED | SKIPPED | EXCLUDED.</param>
/// <param name="Reason">Why it was skipped, excluded or failed (the code).</param>
/// <param name="CheckNumberTaskId">The CheckNumber.ai task whose answer made the number eligible.</param>
public sealed record WatiBroadcastRecipientView(
    string Number,
    string? ContactName,
    string Status,
    string? Reason,
    string? ReasonText,
    Guid? SourceJobId,
    string? SourceJobNumber,
    string? CheckNumberTaskId,
    DateTimeOffset? SentAtUtc,
    DateTimeOffset? DeliveredAtUtc,
    DateTimeOffset? ReadAtUtc,
    DateTimeOffset? FailedAtUtc,
    string? RenderedText,
    string? LocalMessageId);
