namespace YDots.DON.Domain.Enums;

/// <summary>"Last contact outcome" badge on the lead work queue.</summary>
public enum ContactOutcome
{
    NotContacted = 0,
    Reached = 1,
    NoAnswer = 2,
    CallbackRequested = 3,
    NotInterested = 4,
    WrongNumber = 5,
    DoNotContact = 6,

    // ---- Outcomes the Communication Timeline offers --------------------------------------------
    //
    // ADDED RATHER THAN MAPPED ONTO THE SIX ABOVE. The timeline's log form offers ten outcomes,
    // and squeezing "Interested", "Meeting scheduled" or "Donation discussion" into "Reached"
    // threw away exactly the signal the lead's health and the suggested next step read. Stored as
    // strings, so adding values touches no existing row.

    Interested = 7,

    MeetingScheduled = 8,

    MeetingCompleted = 9,

    InformationRequested = 10,

    DonationDiscussion = 11
}
