using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDots.DON.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFollowUpExecutionDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "completion_reason",
                table: "don_follow_up_tasks",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "disposition",
                table: "don_follow_up_tasks",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "execution_status",
                table: "don_follow_up_tasks",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "completion_reason",
                table: "don_follow_up_tasks");

            migrationBuilder.DropColumn(
                name: "disposition",
                table: "don_follow_up_tasks");

            migrationBuilder.DropColumn(
                name: "execution_status",
                table: "don_follow_up_tasks");
        }
    }
}
