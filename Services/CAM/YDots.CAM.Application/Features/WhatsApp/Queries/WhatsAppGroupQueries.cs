using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Features.WhatsApp.Queries;

public sealed record GetWhatsAppGroupsQuery;

public sealed record GetWhatsAppGroupQuery(Guid GroupId);

/// <summary>The recipient groups, read for the Groups tab and the pickers. Organisation-scoped by the store.</summary>
public sealed class WhatsAppGroupQueryHandler(IWhatsAppRecipientGroupStore groups)
{
    public async Task<Result<IReadOnlyList<WhatsAppGroupView>>> HandleAsync(GetWhatsAppGroupsQuery query, CancellationToken cancellationToken) =>
        Result.Success(await groups.ListAsync(cancellationToken));

    public async Task<Result<WhatsAppGroupDetail>> HandleAsync(GetWhatsAppGroupQuery query, CancellationToken cancellationToken) =>
        await groups.GetAsync(query.GroupId, cancellationToken) is { } group
            ? Result.Success(group)
            : Result.Failure<WhatsAppGroupDetail>(Error.NotFound("That group was not found."));
}
