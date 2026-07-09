const notificationService = require('../services/notification.service');
const { successResponse } = require('../utils/helpers');

const myNotifications = async (req, res, next) => {
  try {
    const result = await notificationService.listMyNotifications(req.user.id, req.query);
    successResponse(res, 'Notifications fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const unreadCount = async (req, res, next) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    successResponse(res, 'Unread count fetched', { count });
  } catch (err) { next(err); }
};

const markAsRead = async (req, res, next) => {
  try {
    const data = await notificationService.markRead(req.user.id, req.params.id);
    successResponse(res, 'Notification marked as read', data);
  } catch (err) { next(err); }
};

const markAllAsRead = async (req, res, next) => {
  try {
    await notificationService.markAllRead(req.user.id);
    successResponse(res, 'All notifications marked as read');
  } catch (err) { next(err); }
};

module.exports = {
  myNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
};

