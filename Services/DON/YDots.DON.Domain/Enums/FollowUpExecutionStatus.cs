namespace YDots.DON.Domain.Enums;

/// <summary>
/// How far the planned contact actually got, as the person who made it judged it.
///
/// NOT THE FOLLOW-UP'S STATUS. A follow-up that is executed is Completed whatever happened on the
/// call; this says what "executed" amounted to - a full conversation, half of one, or no answer.
/// </summary>
public enum FollowUpExecutionStatus
{
    Completed = 1,
    PartiallyCompleted = 2,
    NoResponse = 3,
    Cancelled = 4
}
