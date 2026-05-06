import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const gateQuerySchema = createSchema({
  gateKey: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  },
  workspaceSlug: {
    type: "string",
    required: false,
    minLength: 1,
    maxLength: 120
  }
});

const currentQueryInputValidator = deepFreeze({
  schema: gateQuerySchema,
  mode: "patch"
});

const startCommandInputValidator = deepFreeze({
  schema: gateQuerySchema,
  mode: "patch"
});

const grantCommandInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "id",
      required: true
    },
    workspaceSlug: {
      type: "string",
      required: false,
      minLength: 1,
      maxLength: 120
    }
  }),
  mode: "patch"
});

const closeCommandInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "id",
      required: true
    },
    workspaceSlug: {
      type: "string",
      required: false,
      minLength: 1,
      maxLength: 120
    }
  }),
  mode: "patch"
});

const gateRuleOutputSchema = createSchema({
  id: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  gateKey: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  },
  surface: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 64
  },
  enabled: {
    type: "boolean",
    required: true
  },
  unlockMinutes: {
    type: "integer",
    required: true,
    min: 0
  },
  cooldownMinutes: {
    type: "integer",
    required: true,
    min: 0
  },
  dailyLimit: {
    type: "integer",
    required: false,
    nullable: true,
    min: 0
  },
  title: {
    type: "string",
    required: true
  },
  description: {
    type: "string",
    required: true
  }
});

const providerConfigOutputSchema = createSchema({
  id: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  surface: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 64
  },
  enabled: {
    type: "boolean",
    required: true
  },
  adUnitPath: {
    type: "string",
    required: true
  },
  scriptMode: {
    type: "string",
    required: true
  }
});

const watchSessionOutputSchema = createSchema({
  id: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  gateKey: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  },
  providerConfigId: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  status: {
    type: "string",
    required: true,
    minLength: 1
  },
  startedAt: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  rewardedAt: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  completedAt: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  closedAt: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  }
});

const unlockReceiptOutputSchema = createSchema({
  id: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  gateKey: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  },
  providerConfigId: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  watchSessionId: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  grantedAt: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  },
  unlockedUntil: {
    type: "string",
    required: false,
    nullable: true,
    minLength: 1
  }
});

function createGateStateOutputValidator({
  includeSession = false
} = {}) {
  const fields = {
    gateKey: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 120
    },
    workspaceSlug: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 120
    },
    surface: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 64
    },
    enabled: {
      type: "boolean",
      required: true
    },
    available: {
      type: "boolean",
      required: true
    },
    blocked: {
      type: "boolean",
      required: true
    },
    reason: {
      type: "string",
      required: true,
      minLength: 1
    },
    rule: {
      type: "object",
      required: false,
      nullable: true,
      schema: gateRuleOutputSchema
    },
    providerConfig: {
      type: "object",
      required: false,
      nullable: true,
      schema: providerConfigOutputSchema
    },
    unlock: {
      type: "object",
      required: false,
      nullable: true,
      schema: unlockReceiptOutputSchema
    },
    cooldownUntil: {
      type: "string",
      required: false,
      nullable: true,
      minLength: 1
    },
    dailyLimitRemaining: {
      type: "integer",
      required: false,
      nullable: true,
      min: 0
    }
  };

  if (includeSession === true) {
    fields.session = {
      type: "object",
      required: false,
      nullable: true,
      schema: watchSessionOutputSchema
    };
  }

  return deepFreeze({
    schema: createSchema(fields),
    mode: "replace"
  });
}

const currentStateOutputValidator = createGateStateOutputValidator();
const startGateOutputValidator = createGateStateOutputValidator({
  includeSession: true
});

const grantRewardOutputValidator = deepFreeze({
  schema: createSchema({
    unlocked: {
      type: "boolean",
      required: true
    },
    workspaceSlug: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 120
    },
    gateKey: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 120
    },
    unlock: {
      type: "object",
      required: false,
      nullable: true,
      schema: unlockReceiptOutputSchema
    },
    session: {
      type: "object",
      required: false,
      nullable: true,
      schema: watchSessionOutputSchema
    }
  }),
  mode: "replace"
});

const closeSessionOutputValidator = deepFreeze({
  schema: createSchema({
    closed: {
      type: "boolean",
      required: true
    },
    workspaceSlug: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 120
    },
    gateKey: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 120
    },
    session: {
      type: "object",
      required: false,
      nullable: true,
      schema: watchSessionOutputSchema
    },
    reason: {
      type: "string",
      required: false,
      nullable: true,
      minLength: 1
    }
  }),
  mode: "replace"
});

export {
  currentQueryInputValidator,
  startCommandInputValidator,
  grantCommandInputValidator,
  closeCommandInputValidator,
  currentStateOutputValidator,
  startGateOutputValidator,
  grantRewardOutputValidator,
  closeSessionOutputValidator
};
