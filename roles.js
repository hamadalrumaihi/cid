/* roles.js — shared CID role + bureau vocabulary.
   Classic script sharing one global lexical scope with the other app *.js files.
   Loaded AFTER supabase.js and BEFORE core.js so every module relies on one
   canonical definition of the 5 roles and 4 bureaus instead of ad-hoc copies.

   Roles (profiles.role, enum app_role):
     detective < senior_detective < bureau_lead < deputy_director < director
   Command staff = bureau_lead, deputy_director, director (director is supreme).
   Bureaus (profiles.division, enum bureau): LSB, BCB, SAB, JTF. */
"use strict";

    const CID_ROLE_ORDER = ['detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director'];
    const CID_ROLE_LABEL = {
      detective: 'Detective', senior_detective: 'Senior Detective',
      bureau_lead: 'Bureau Lead', deputy_director: 'Deputy Director', director: 'Director',
    };
    const CID_COMMAND_ROLES = ['bureau_lead', 'deputy_director', 'director'];
    const CID_SUBMIT_ROLES = ['detective', 'senior_detective'];
    const CID_BUREAUS = { LSB: 'Los Santos Bureau', BCB: 'Blaine County Bureau', SAB: 'State Bureau', JTF: 'Joint Task Force' };

    const cidRoleLabel = (r) => CID_ROLE_LABEL[r] || r || '—';
    const cidBureauLabel = (b) => CID_BUREAUS[b] || b || '—';
    const cidRoleRank = (r) => CID_ROLE_ORDER.indexOf(r);
    const cidIsCommandRole = (r) => CID_COMMAND_ROLES.includes(r);
    const cidIsSubmitRole = (r) => CID_SUBMIT_ROLES.includes(r);
    // True when the signed-in, active user holds a command role.
    function cidMeIsCommand() {
      const m = (window.CIDDB && window.CIDDB.me) || null;
      return !!(m && m.active && cidIsCommandRole(m.role));
    }

    window.CIDRoles = {
      ORDER: CID_ROLE_ORDER,
      LABEL: CID_ROLE_LABEL,
      COMMAND: CID_COMMAND_ROLES,
      SUBMIT: CID_SUBMIT_ROLES,
      BUREAUS: CID_BUREAUS,
      roleLabel: cidRoleLabel,
      bureauLabel: cidBureauLabel,
      rank: cidRoleRank,
      isCommandRole: cidIsCommandRole,
      isSubmitRole: cidIsSubmitRole,
      meIsCommand: cidMeIsCommand,
    };
