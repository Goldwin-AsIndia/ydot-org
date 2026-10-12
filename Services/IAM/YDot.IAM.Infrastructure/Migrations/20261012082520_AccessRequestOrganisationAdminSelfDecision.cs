using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDot.IAM.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AccessRequestOrganisationAdminSelfDecision : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_iam_access_requests_independent_approver",
                table: "iam_access_requests");

            migrationBuilder.AddColumn<bool>(
                name: "self_decided_by_organisation_admin",
                table: "iam_access_requests",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddCheckConstraint(
                name: "ck_iam_access_requests_independent_approver",
                table: "iam_access_requests",
                sql: "decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id OR self_decided_by_organisation_admin");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_iam_access_requests_independent_approver",
                table: "iam_access_requests");

            migrationBuilder.DropColumn(
                name: "self_decided_by_organisation_admin",
                table: "iam_access_requests");

            migrationBuilder.AddCheckConstraint(
                name: "ck_iam_access_requests_independent_approver",
                table: "iam_access_requests",
                sql: "decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id");
        }
    }
}
