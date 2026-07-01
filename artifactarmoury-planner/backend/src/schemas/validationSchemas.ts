// backend/src/schemas/validationSchemas.ts
// Comprehensive validation schemas for all API endpoints

import { ValidationSchema } from '../middleware/requestValidator';

// ============================================================================
// AUTH SCHEMAS
// ============================================================================

export const registerSchema: ValidationSchema = {
  body: {
    email: {
      type: 'email',
      required: true,
      maxLength: 255
    },
    password: {
      type: 'string',
      required: true,
      minLength: 8,
      maxLength: 128
    },
    displayName: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 255
    },
    artistName: {
      type: 'string',
      required: false,
      minLength: 2,
      maxLength: 255
    },
    inviteCode: {
      type: 'string',
      required: false,
      minLength: 6,
      maxLength: 50
    }
  }
};

export const loginSchema: ValidationSchema = {
  body: {
    email: {
      type: 'email',
      required: true
    },
    password: {
      type: 'string',
      required: true,
      minLength: 1
    }
  }
};

export const passwordResetSchema: ValidationSchema = {
  body: {
    email: {
      type: 'email',
      required: true
    }
  }
};

export const passwordUpdateSchema: ValidationSchema = {
  body: {
    currentPassword: {
      type: 'string',
      required: true
    },
    newPassword: {
      type: 'string',
      required: true,
      minLength: 8,
      maxLength: 128
    }
  }
};

// ============================================================================
// MODEL SCHEMAS
// ============================================================================

export const createModelSchema: ValidationSchema = {
  body: {
    name: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 255
    },
    description: {
      type: 'string',
      required: false,
      maxLength: 5000
    },
    category: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 100
    },
    tags: {
      type: 'array',
      required: false,
      maxLength: 20,
      items: {
        type: 'string',
        maxLength: 50
      }
    },
    basePrice: {
      type: 'number',
      required: true,
      min: 0.5,
      max: 10000
    },
    license: {
      type: 'string',
      required: false,
      enum: ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc', 'standard-commercial', 'personal-use']
    }
  }
};

export const updateModelSchema: ValidationSchema = {
  body: {
    name: {
      type: 'string',
      required: false,
      minLength: 3,
      maxLength: 255
    },
    description: {
      type: 'string',
      required: false,
      maxLength: 5000
    },
    category: {
      type: 'string',
      required: false,
      minLength: 1,
      maxLength: 100
    },
    tags: {
      type: 'array',
      required: false,
      maxLength: 20,
      items: {
        type: 'string',
        maxLength: 50
      }
    },
    basePrice: {
      type: 'number',
      required: false,
      min: 0.5,
      max: 10000
    },
    license: {
      type: 'string',
      required: false,
      enum: ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc', 'standard-commercial', 'personal-use']
    }
  },
  params: {
    id: {
      type: 'uuid',
      required: true
    }
  }
};

// ============================================================================
// BROWSE SCHEMAS
// ============================================================================

export const browseModelsSchema: ValidationSchema = {
  query: {
    category: {
      type: 'string',
      required: false,
      maxLength: 100
    },
    tags: {
      type: 'string',
      required: false,
      maxLength: 500
    },
    minPrice: {
      type: 'number',
      required: false,
      min: 0
    },
    maxPrice: {
      type: 'number',
      required: false,
      min: 0,
      max: 10000
    },
    sortBy: {
      type: 'string',
      required: false,
      enum: ['recent', 'trending', 'price_low', 'price_high', 'name']
    },
    page: {
      type: 'number',
      required: false,
      min: 1
    },
    limit: {
      type: 'number',
      required: false,
      min: 1,
      max: 100
    },
    search: {
      type: 'string',
      required: false,
      maxLength: 500
    }
  }
};

// ============================================================================
// ORDER SCHEMAS
// ============================================================================

export const createOrderSchema: ValidationSchema = {
  body: {
    items: {
      type: 'array',
      required: true,
      minLength: 1,
      maxLength: 50,
      items: {
        type: 'object'
      }
    },
    shipping: {
      type: 'object',
      required: true
    },
    customerEmail: {
      type: 'email',
      required: false
    }
  }
};

// ============================================================================
// TABLE SCHEMAS
// ============================================================================

export const createTableSchema: ValidationSchema = {
  body: {
    name: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 255
    },
    description: {
      type: 'string',
      required: false,
      maxLength: 5000
    },
    width: {
      type: 'number',
      required: false,
      min: 1,
      max: 10000
    },
    depth: {
      type: 'number',
      required: false,
      min: 1,
      max: 10000
    },
    isPublic: {
      type: 'boolean',
      required: false
    }
  }
};

// ============================================================================
// ADMIN SCHEMAS
// ============================================================================

export const flagModelSchema: ValidationSchema = {
  body: {
    reason: {
      type: 'string',
      required: true,
      minLength: 10,
      maxLength: 1000
    }
  },
  params: {
    id: {
      type: 'uuid',
      required: true
    }
  }
};

export default {
  registerSchema,
  loginSchema,
  passwordResetSchema,
  passwordUpdateSchema,
  createModelSchema,
  updateModelSchema,
  browseModelsSchema,
  createOrderSchema,
  createTableSchema,
  flagModelSchema
};

