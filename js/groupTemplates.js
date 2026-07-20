// ======================================================================
// Persona group templates — extracted from the reference group export
// (EXAMPLE_Export_groups). Used by the Assign-groups tool to create
// missing groups directly via Graph. Static groups are ALWAYS created as
// role-assignable (isAssignableToRole: true) — always, without exception.
// Templates marked "dynamic" carry a membership rule for reference, but Graph
// forbids role-assignable + dynamic membership, so they are created as
// assigned role-assignable groups and the rule is reported for manual setup.
// ======================================================================
const GROUP_TEMPLATES = [
  {
    "displayName": "CAB-SEC-U-BreakGlass",
    "description": "Description of CAB-SEC-U-BreakGlass",
    "mailNickname": "CABSECUBreakGlass"
  },
  {
    "displayName": "CAB-SEC-U-CA001-Exclusion",
    "description": "Description of CAB-SEC-U-CA001-Exclusion",
    "mailNickname": "CABSECUCA001Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA002-Exclusion",
    "description": "Description of CAB-SEC-U-CA002-Exclusion",
    "mailNickname": "CABSECUCA002Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA003-Exclusion",
    "description": "Description of CAB-SEC-U-CA003-Exclusion",
    "mailNickname": "CABSECUCA003Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA004-Exclusion",
    "description": "Description of CAB-SEC-U-CA004-Exclusion",
    "mailNickname": "CABSECUCA004Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA005-Exclusion",
    "description": "Description of CAB-SEC-U-CA005-Exclusion",
    "mailNickname": "CABSECUCA005Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA006-Exclusion",
    "description": "Description of CAB-SEC-U-CA006-Exclusion",
    "mailNickname": "CABSECUCA006Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA007-Exclusion",
    "description": "Description of CAB-SEC-U-CA007-Exclusion",
    "mailNickname": "CABSECUCA007Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA008-Exclusion",
    "description": "Description of CAB-SEC-U-CA008-Exclusion",
    "mailNickname": "CABSECUCA008Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA009-Exclusion",
    "description": "Description of CAB-SEC-U-CA009-Exclusion",
    "mailNickname": "CABSECUCA009Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA010-Exclusion",
    "description": "Description of CAB-SEC-U-CA010-Exclusion",
    "mailNickname": "CABSECUCA010Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA011-Exclusion",
    "description": "Description of CAB-SEC-U-CA011-Exclusion",
    "mailNickname": "CABSECUCA011Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA012-Exclusion",
    "description": "Description of CAB-SEC-U-CA012-Exclusion",
    "mailNickname": "CABSECUCA012Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA013-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA013-Exclusion",
    "mailNickname": "CABSECUCA013Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA014-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA014-Exclusion",
    "mailNickname": "CABSECUCA014Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA015-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA015-Exclusion",
    "mailNickname": "CABSECUCA015Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA016-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA016-Exclusion",
    "mailNickname": "CABSECUCA016Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA017-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA017-Exclusion",
    "mailNickname": "CABSECUCA017Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA100-Exclusion",
    "description": "Description of CAB-SEC-U-CA100-Exclusion",
    "mailNickname": "CABSECUCA100Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1000-Exclusion",
    "description": "Description of CAB-SEC-U-CA1000-Exclusion",
    "mailNickname": "CABSECUCA1000Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1001-Exclusion",
    "description": "Description of CAB-SEC-U-CA1001-Exclusion",
    "mailNickname": "CABSECUCA1001Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1002-Exclusion",
    "description": "Description of CAB-SEC-U-CA1002-Exclusion",
    "mailNickname": "CABSECUCA1002Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1003-Exclusion",
    "description": "Description of CAB-SEC-U-CA1003-Exclusion",
    "mailNickname": "CABSECUCA1003Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1004-Exclusion",
    "description": "Description of CAB-SEC-U-CA1004-Exclusion",
    "mailNickname": "CABSECUCA1004Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1005-Exclusion",
    "description": "Description of CAB-SEC-U-CA1005-Exclusion",
    "mailNickname": "CABSECUCA1005Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1006-Exclusion",
    "description": "Description of CAB-SEC-U-CA1006-Exclusion",
    "mailNickname": "CABSECUCA1006Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA1007-Exclusion",
    "description": "",
    "mailNickname": "9f73fb05e"
  },
  {
    "displayName": "CAB-SEC-U-CA101-Exclusion",
    "description": "Description of CAB-SEC-U-CA101-Exclusion",
    "mailNickname": "CABSECUCA101Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA102-Exclusion",
    "description": "Description of CAB-SEC-U-CA102-Exclusion",
    "mailNickname": "CABSECUCA102Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA103-Exclusion",
    "description": "Description of CAB-SEC-U-CA103-Exclusion",
    "mailNickname": "CABSECUCA103Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA104-Exclusion",
    "description": "Description of CAB-SEC-U-CA104-Exclusion",
    "mailNickname": "CABSECUCA104Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA105-Exclusion",
    "description": "Description of CAB-SEC-U-CA105-Exclusion",
    "mailNickname": "CABSECUCA105Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA106-Exclusion",
    "description": "Description of CAB-SEC-U-CA106-Exclusion",
    "mailNickname": "CABSECUCA106Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA107-Exclusion",
    "description": "Description of CAB-SEC-U-CA107-Exclusion",
    "mailNickname": "CABSECUCA107Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA108-Exclusion",
    "description": "Description of CAB-SEC-U-CA108-Exclusion",
    "mailNickname": "CABSECUCA108Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA109-Exclusion",
    "description": "Description of CAB-SEC-U-CA109-Exclusion",
    "mailNickname": "CABSECUCA109Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA110-Exclusion",
    "description": "Description of CAB-SEC-U-CA110-Exclusion",
    "mailNickname": "CABSECUCA110Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA111-Exclusion",
    "description": "",
    "mailNickname": "a469a46ce"
  },
  {
    "displayName": "CAB-SEC-U-CA112-Exclusion",
    "description": "Description of CAB-SEC-U-CA112-Exclusion",
    "mailNickname": "CABSECUCA112Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA200-Exclusion",
    "description": "Description of CAB-SEC-U-CA200-Exclusion",
    "mailNickname": "CABSECUCA200Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA201-Exclusion",
    "description": "Description of CAB-SEC-U-CA201-Exclusion",
    "mailNickname": "CABSECUCA201Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA202-Exclusion",
    "description": "Description of CAB-SEC-U-CA202-Exclusion",
    "mailNickname": "CABSECUCA202Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA203-Exclusion",
    "description": "Description of CAB-SEC-U-CA203-Exclusion",
    "mailNickname": "CABSECUCA203Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA204-Exclusion",
    "description": "Description of CAB-SEC-U-CA204-Exclusion",
    "mailNickname": "CABSECUCA204Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA205-Exclusion",
    "description": "Description of CAB-SEC-U-CA205-Exclusion",
    "mailNickname": "CABSECUCA205Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA206-Exclusion",
    "description": "Description of CAB-SEC-U-CA206-Exclusion",
    "mailNickname": "CABSECUCA206Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA207-Exclusion",
    "description": "Description of CAB-SEC-U-CA207-Exclusion",
    "mailNickname": "CABSECUCA207Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA208-Exclusion",
    "description": "Description of CAB-SEC-U-CA208-Exclusion",
    "mailNickname": "CABSECUCA208Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA209-Exclusion",
    "description": "Description of CAB-SEC-U-CA209-Exclusion",
    "mailNickname": "CABSECUCA209Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA210-Exclusion",
    "description": "Description of CAB-SEC-U-CA210-Exclusion",
    "mailNickname": "CABSECUCA210Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA211-Exclusion",
    "description": "Description of CAB-SEC-U-CA211-Exclusion",
    "mailNickname": "CABSECUCA211Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA212-Exclusion",
    "description": "Description of CAB-SEC-U-CA212-Exclusion",
    "mailNickname": "CABSECUCA212Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA213-Exclusion",
    "description": "Description of CAB-SEC-U-CA213-Exclusion",
    "mailNickname": "CABSECUCA213Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA213-Inclusion",
    "description": "Description of CAB-SEC-U-CA213-Inclusion",
    "mailNickname": "CABSECUCA213Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA214-Exclusion",
    "description": "Description of CAB-SEC-U-CA214-Exclusion",
    "mailNickname": "CABSECUCA214Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA300-Exclusion",
    "description": "Description of CAB-SEC-U-CA300-Exclusion",
    "mailNickname": "CABSECUCA300Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA301-Exclusion",
    "description": "Description of CAB-SEC-U-CA301-Exclusion",
    "mailNickname": "CABSECUCA301Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA302-Exclusion",
    "description": "Description of CAB-SEC-U-CA302-Exclusion",
    "mailNickname": "CABSECUCA302Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA303-Exclusion",
    "description": "Description of CAB-SEC-U-CA303-Exclusion",
    "mailNickname": "CABSECUCA303Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA304-Exclusion",
    "description": "Description of CAB-SEC-U-CA304-Exclusion",
    "mailNickname": "CABSECUCA304Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA305-Exclusion",
    "description": "Description of CAB-SEC-U-CA305-Exclusion",
    "mailNickname": "CABSECUCA305Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA306-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA306-Exclusion",
    "mailNickname": "CABSECUCA306Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA307-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA307-Exclusion",
    "mailNickname": "CABSECUCA307Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA308-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA308-Exclusion",
    "mailNickname": "CABSECUCA308Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA309-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA309-Exclusion",
    "mailNickname": "CABSECUCA309Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA400-Exclusion",
    "description": "Description of CAB-SEC-U-CA400-Exclusion",
    "mailNickname": "CABSECUCA400Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA401-Exclusion",
    "description": "Description of CAB-SEC-U-CA401-Exclusion",
    "mailNickname": "CABSECUCA401Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA402-Exclusion",
    "description": "Description of CAB-SEC-U-CA402-Exclusion",
    "mailNickname": "CABSECUCA402Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA403-Exclusion",
    "description": "Description of CAB-SEC-U-CA403-Exclusion",
    "mailNickname": "CABSECUCA403Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA404-Exclusion",
    "description": "Description of CAB-SEC-U-CA404-Exclusion",
    "mailNickname": "CABSECUCA404Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA405-Exclusion",
    "description": "Description of CAB-SEC-U-CA405-Exclusion",
    "mailNickname": "CABSECUCA405Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA406-Exclusion",
    "description": "",
    "mailNickname": "5d7a8a774"
  },
  {
    "displayName": "CAB-SEC-U-CA500-Exclusion",
    "description": "Description of CAB-SEC-U-CA500-Exclusion",
    "mailNickname": "CABSECUCA500Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA501-Exclusion",
    "description": "Description of CAB-SEC-U-CA501-Exclusion",
    "mailNickname": "CABSECUCA501Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA502-Exclusion",
    "description": "Description of CAB-SEC-U-CA502-Exclusion",
    "mailNickname": "CABSECUCA502Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA503-Exclusion",
    "description": "Description of CAB-SEC-U-CA503-Exclusion",
    "mailNickname": "CABSECUCA503Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA504-Exclusion",
    "description": "Description of CAB-SEC-U-CA504-Exclusion",
    "mailNickname": "CABSECUCA504Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA505-Exclusion",
    "description": "Description of CAB-SEC-U-CA505-Exclusion",
    "mailNickname": "CABSECUCA505Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA506-Exclusion",
    "description": "Description of CAB-SEC-U-CA506-Exclusion",
    "mailNickname": "CABSECUCA506Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA507-Exclusion",
    "description": "Description of CAB-SEC-U-CA507-Exclusion",
    "mailNickname": "CABSECUCA507Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA508-Exclusion",
    "description": "CA Baseline group - CAB-SEC-U-CA508-Exclusion",
    "mailNickname": "CABSECUCA508Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA600-Exclusion",
    "description": "Description of CAB-SEC-U-CA600-Exclusion",
    "mailNickname": "CABSECUCA600Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA601-Exclusion",
    "description": "",
    "mailNickname": "0659a25af"
  },
  {
    "displayName": "CAB-SEC-U-CA602-Exclusion",
    "description": "Description of CAB-SEC-U-CA602-Exclusion",
    "mailNickname": "CABSECUCA602Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA603-Exclusion",
    "description": "Description of CAB-SEC-U-CA603-Exclusion",
    "mailNickname": "CABSECUCA603Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-CA604-Exclusion",
    "description": "Description of CAB-SEC-U-CA604-Exclusion",
    "mailNickname": "CABSECUCA604Exclusion"
  },
  {
    "displayName": "CAB-SEC-U-Persona-Admins",
    "description": "Description of CAB-SEC-U-Persona-Admins",
    "mailNickname": "CABSECUPersonaAdmins"
  },
  {
    "displayName": "CAB-SEC-U-Persona-DevOps",
    "description": "Description of CAB-SEC-U-Persona-DevOps",
    "mailNickname": "CABSECUPersonaDevOps"
  },
  {
    "displayName": "CAB-SEC-U-Persona-Externals",
    "description": "Group for all External users",
    "mailNickname": "CABSECUPersonaExternals",
    "dynamic": true,
    "membershipRule": "(user.userType -eq \"External\")"
  },
  {
    "displayName": "CAB-SEC-U-Persona-GuestAdmins",
    "description": "Group for all Guest Admins",
    "mailNickname": "CABSECUPersonaGuestAdmins",
    "dynamic": true,
    "membershipRule": "(user.userType -eq \"GuestAdmin\")"
  },
  {
    "displayName": "CAB-SEC-U-Persona-GuestUsers",
    "description": "Group for all Guest users",
    "mailNickname": "CABSECUPersonaGuestUsers",
    "dynamic": true,
    "membershipRule": "(user.userPrincipalName -contains \"#EXT#\")"
  },
  {
    "displayName": "CAB-SEC-U-Persona-Internals",
    "description": "All Entra ID P1 enabled users",
    "mailNickname": "CABSECUPersonaInternals",
    "dynamic": true,
    "membershipRule": "user.assignedPlans -any (assignedPlan.servicePlanId -eq \"41781fb2-bc02-4b7c-bd55-b576c07bb09d\" -and assignedPlan.capabilityStatus -eq \"Enabled\")"
  },
  {
    "displayName": "CAB-SEC-U-Persona-Microsoft365ServiceAccounts",
    "description": "Description of CAB-SEC-U-Persona-Microsoft365ServiceAccounts",
    "mailNickname": "CABSECUPersonaMicrosoft365ServiceAccounts"
  },
  {
    "displayName": "CAD-SEC-U-DG-GLO",
    "description": "CA Baseline group - CAD-SEC-U-DG-GLO",
    "mailNickname": "CADSECUDGGLO"
  },
  {
    "displayName": "CAD-SEC-U-DG-GUESTAdmins",
    "description": "CA Baseline group - CAD-SEC-U-DG-GUESTAdmins",
    "mailNickname": "CADSECUDGGUESTAdmins"
  },
  {
    "displayName": "CAD-SEC-U-DG-INT",
    "description": "CA Baseline group - CAD-SEC-U-DG-INT",
    "mailNickname": "CADSECUDGINT"
  },
  {
    "displayName": "Emergency_Access1",
    "description": "CA Baseline group - Emergency_Access1",
    "mailNickname": "EmergencyAccess1"
  },
  {
    "displayName": "Emergency_Access2",
    "description": "CA Baseline group - Emergency_Access2",
    "mailNickname": "EmergencyAccess2"
  }
];
