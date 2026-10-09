namespace YDots.DON.Domain.Enums;

/// <summary>Who started a recorded exchange.</summary>
public enum InteractionDirection
{
    /// <summary>The charity reached out.</summary>
    Outgoing = 1,

    /// <summary>The supporter reached out - a call back, a reply, a walk-in.</summary>
    Incoming = 2,

    /// <summary>A note the team wrote for itself. Nobody outside was contacted.</summary>
    Internal = 3
}
