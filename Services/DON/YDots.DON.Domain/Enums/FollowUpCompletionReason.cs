namespace YDots.DON.Domain.Enums;

/// <summary>Why the follow-up ended the way it did.</summary>
public enum FollowUpCompletionReason
{
    SuccessfullyCompleted = 1,
    PartiallyCompleted = 2,
    ContactUnavailable = 3,
    CancelledByContact = 4,
    WrongContact = 5,
    Escalated = 6,
    Converted = 7,
    NoResponse = 8
}
