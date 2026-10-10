using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDots.DON.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFollowUpAttachmentName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "attachment_name",
                table: "don_follow_up_tasks",
                type: "character varying(260)",
                maxLength: 260,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "attachment_name",
                table: "don_follow_up_tasks");
        }
    }
}
