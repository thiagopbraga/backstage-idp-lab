export interface Config {
  fastflow?: {
    permission?: {
      /**
       * Groups whose members bypass the ownership rules (platform admin /
       * break-glass). Default ['group:default/fastflow'].
       */
      platformAdminGroups?: string[];
      /**
       * Scaffolder actions that may only run when their `owner` input is one of
       * the initiator's groups. Default ['fastflow:governance:validate'].
       */
      ownerScopedActions?: string[];
    };
  };
}
