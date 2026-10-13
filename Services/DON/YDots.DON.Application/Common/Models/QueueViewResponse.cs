namespace YDots.DON.Application.Common.Models;

/// <summary>
/// One view of a list - a lane, a figure, a "needs attention" shortcut: its key, its words, a
/// line under it and how many records it holds across the caller's whole scope.
///
/// THE COUNT AND THE ROWS COME FROM ONE RULE. Sending <see cref="Value"/> back to the same list
/// returns exactly the records the count counted, because the server applies the view it named.
/// </summary>
public sealed record QueueViewResponse(string Value, string Label, string Description, int Count);
