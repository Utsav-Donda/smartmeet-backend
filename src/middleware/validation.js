'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * Returns an Express middleware that validates `req[source]` (default
 * 'body') against a Joi schema. On success, the request property is
 * replaced with the validated & coerced value (defaults applied, unknown
 * stripped) so downstream code can trust its shape.
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map((d) => ({ message: d.message, path: d.path }));
      return next(new ValidationError('Invalid request data', details));
    }

    req[source] = value;
    return next();
  };
}

module.exports = { validate };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR VALIDATION MIDDLEWARE:
1. Support validating multiple sources at once (body + params + query) in a single call to avoid stacking three validate() calls on routes that need it.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Low
*/
