'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Joi schema validation middleware factory.
 * Validates req.body, req.query, or req.params against the provided Joi schema.
 *
 * @param {import('joi').Schema} schema - Joi schema to validate against
 * @param {'body'|'query'|'params'} [source='body'] - which part of req to validate
 * @returns {Function} Express middleware
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }

    req[source] = value;
    next();
  };
}

module.exports = { validate };
