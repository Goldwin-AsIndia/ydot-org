using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using YDots.CAM.Domain.Entities;

namespace YDots.CAM.Infrastructure.Persistence.Configurations;

/// <summary>
/// WhatsApp recipient groups: the named, tagged picks an organisation keeps for its sends.
///
/// THE ONLY WHATSAPP TABLES CAM OWNS. Everything else on the WhatsApp screens - checks, numbers,
/// sends, messages - lives in the integration worker's int_* tables, which CAM reads but never
/// migrates. A group is a person's curation, not a step of the pipeline, so it belongs here.
/// </summary>
public sealed class WhatsAppRecipientGroupConfiguration : IEntityTypeConfiguration<WhatsAppRecipientGroup>
{
    public void Configure(EntityTypeBuilder<WhatsAppRecipientGroup> builder)
    {
        builder.ToTable("cam_whatsapp_recipient_groups", table =>
            table.HasComment("Named, tagged sets of WhatsApp-verified numbers kept for sends from the WhatsApp Messages page."));

        builder.HasKey(group => group.Id);

        // One name per organisation; the handler compares names ignoring case before saving.
        builder.HasIndex(group => new { group.TenantId, group.Name })
            .HasDatabaseName("ix_cam_whatsapp_recipient_groups_tenant_name")
            .IsUnique();

        builder.HasIndex(group => group.CampaignId)
            .HasDatabaseName("ix_cam_whatsapp_recipient_groups_campaign");

        builder.Property(group => group.Name).HasMaxLength(120).IsRequired();
        builder.Property(group => group.Description).HasMaxLength(500);
        builder.Property(group => group.Tags).HasColumnType("text[]").IsRequired();
        builder.Property(group => group.CreatedByName).HasMaxLength(200);
        builder.Property(group => group.UpdatedByName).HasMaxLength(200);
        builder.Property(group => group.Version).IsConcurrencyToken();

        // A campaign that is removed leaves its groups in place, simply no longer tied to it.
        builder.HasOne<Campaign>()
            .WithMany()
            .HasForeignKey(group => group.CampaignId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasMany(group => group.Members)
            .WithOne(member => member.Group)
            .HasForeignKey(member => member.GroupId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class WhatsAppRecipientGroupMemberConfiguration : IEntityTypeConfiguration<WhatsAppRecipientGroupMember>
{
    public void Configure(EntityTypeBuilder<WhatsAppRecipientGroupMember> builder)
    {
        builder.ToTable("cam_whatsapp_recipient_group_members", table =>
            table.HasComment("The numbers of a recipient group, each with the CheckNumber check job it was picked from."));

        builder.HasKey(member => member.Id);

        builder.HasIndex(member => new { member.GroupId, member.PhoneE164 })
            .HasDatabaseName("ix_cam_whatsapp_recipient_group_members_group_phone")
            .IsUnique();

        // "Which groups is this number in?" - the recipient list shows it and filters by it.
        builder.HasIndex(member => new { member.TenantId, member.PhoneE164 })
            .HasDatabaseName("ix_cam_whatsapp_recipient_group_members_tenant_phone");

        builder.Property(member => member.PhoneE164).HasMaxLength(20).IsRequired();
        builder.Property(member => member.SourceJobNumber).HasMaxLength(30);
        builder.Property(member => member.ContactName).HasMaxLength(120);
        builder.Property(member => member.AddedByName).HasMaxLength(200);
    }
}
