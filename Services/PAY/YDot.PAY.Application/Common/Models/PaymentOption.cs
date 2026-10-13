namespace YDot.PAY.Application.Common.Models;

/// <summary>One choice a screen offers: the value it sends back, the words it shows, and a line about it.</summary>
public sealed record PaymentOption(string Value, string Label, string? Description = null);
