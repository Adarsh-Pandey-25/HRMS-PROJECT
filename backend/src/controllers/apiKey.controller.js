const apiKeyService = require('../services/apiKey.service');
const { successResponse } = require('../utils/helpers');

const list = async (req, res, next) => {
  try {
    const data = await apiKeyService.listApiKeys(req.user);
    successResponse(res, 'API keys fetched', data);
  } catch (err) {
    next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const data = await apiKeyService.createApiKey(req.user, {
      name: req.body.name,
      scopes: req.body.scopes,
      environment: req.body.environment,
      expires_at: req.body.expires_at || req.body.expiresAt || null,
    });
    successResponse(
      res,
      'API key created. Copy plaintextKey now — it will not be shown again.',
      data,
      null,
      201,
    );
  } catch (err) {
    next(err);
  }
};

const revoke = async (req, res, next) => {
  try {
    const data = await apiKeyService.revokeApiKey(req.user, req.params.id);
    successResponse(res, 'API key revoked', data);
  } catch (err) {
    next(err);
  }
};

const scopes = async (req, res, next) => {
  try {
    successResponse(res, 'Available scopes', {
      scopes: apiKeyService.ALLOWED_SCOPES,
      descriptions: {
        ping: 'Verify the key and read company name',
        'employees:read': 'List employees in this company',
        'attendance:write': 'Push biometric punches / attendance events',
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, create, revoke, scopes };
