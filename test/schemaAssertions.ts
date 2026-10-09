export type Schema = (value: unknown, path: string) => void;

export const objectSchema = (fields: Record<string, Schema>, options: { allowUnknown?: boolean } = {}): Schema => {
  return (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${path} must be an object`);
    }

    const objectValue = value as Record<string, unknown>;
    for (const [field, schema] of Object.entries(fields)) {
      schema(objectValue[field], `${path}.${field}`);
    }

    if (options.allowUnknown === false) {
      for (const field of Object.keys(objectValue)) {
        if (!(field in fields)) {
          throw new Error(`${path}.${field} is not allowed`);
        }
      }
    }
  };
};

export const arraySchema = (itemSchema: Schema): Schema => {
  return (value, path) => {
    if (!Array.isArray(value)) {
      throw new Error(`${path} must be an array`);
    }

    value.forEach((item, index) => itemSchema(item, `${path}[${index}]`));
  };
};

export const stringSchema: Schema = (value, path) => {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }
};

export const numberSchema: Schema = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
};

export const optional = (schema: Schema): Schema => {
  return (value, path) => {
    if (value !== undefined) {
      schema(value, path);
    }
  };
};

export const idSchema = objectSchema({
  id: stringSchema
});

export const groupSchema = objectSchema({
  id: stringSchema,
  name: stringSchema
});

export const periodSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  startDate: stringSchema,
  endDate: stringSchema
});

export const playingModeSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  numberOfPeriods: numberSchema,
  periodLengthMinutes: numberSchema,
  minimumPeriodsPerPlayer: numberSchema,
  isDefault: optional((value, path) => {
    if (typeof value !== 'boolean') {
      throw new Error(`${path} must be a boolean`);
    }
  })
});

export const formationSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  slots: arraySchema(objectSchema({
    id: stringSchema,
    positionCode: stringSchema
  }))
});

export const shirtSetSchema = objectSchema({
  id: stringSchema,
  groupId: stringSchema,
  sponsor: stringSchema,
  color: stringSchema,
  shirts: arraySchema(objectSchema({
    number: numberSchema,
    size: stringSchema,
    isGoalkeeper: (value, path) => {
      if (typeof value !== 'boolean') {
        throw new Error(`${path} must be a boolean`);
      }
    }
  }))
});

export const eventSchema = objectSchema({
  id: stringSchema,
  groupId: stringSchema,
  name: stringSchema,
  date: stringSchema,
  maxPlayersPerTeam: numberSchema,
  minPlayersPerTeam: numberSchema,
  teams: arraySchema(objectSchema({
    id: stringSchema,
    name: stringSchema,
    strength: numberSchema,
    startTime: stringSchema,
    selectedPlayers: arraySchema(stringSchema)
  })),
  invitations: arraySchema(objectSchema({
    id: stringSchema,
    playerId: stringSchema,
    status: stringSchema
  }))
});

export const assertSchema = (schema: Schema, value: unknown, label: string): void => {
  schema(value, label);
};
