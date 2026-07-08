const { validationResult } = require('express-validator');
const { BadRequestError } = require('../utils/errors');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    return next(new BadRequestError('Validation failed', details));
  }
  next();
};

module.exports = { validate };
