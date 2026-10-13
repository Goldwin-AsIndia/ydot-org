namespace YDot.IAM.Application.Common.Services;

/// <summary>
/// Counted nouns for messages people read: "1 role", "3 roles" - never "3 role(s)".
/// </summary>
public static class Wording
{
    /// <summary>The count and the noun, singular or plural to match it.</summary>
    public static string Count(int count, string singular, string? plural = null) =>
        $"{count} {(count == 1 ? singular : plural ?? singular + "s")}";

    /// <summary>The verb form that agrees with the count: Verb(1, "has", "have") is "has".</summary>
    public static string Verb(int count, string singular, string plural) =>
        count == 1 ? singular : plural;
}
