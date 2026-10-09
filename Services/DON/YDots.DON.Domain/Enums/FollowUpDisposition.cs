namespace YDots.DON.Domain.Enums;

/// <summary>Where the relationship stands after this follow-up, in the executor's judgement.</summary>
public enum FollowUpDisposition
{
    Interested = 1,
    NurtureLater = 2,
    NotInterested = 3,
    WrongContact = 4,
    Converted = 5,
    Escalated = 6,
    Dormant = 7
}
