import { query } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

export const createCampaign = asyncHandler(async (req, res) => {
  const campaignId = uuidv4();
  const { campaignName, category, country, startDate, endDate, targetTaskCount, createdBy } = req.body;

  const result = await query(
    `INSERT INTO campaigns (campaign_id, campaign_name, category, country, start_date, end_date, target_task_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [campaignId, campaignName, category, country || 'global', startDate, endDate, targetTaskCount, createdBy]
  );

  res.status(201).json({ success: true, data: result.rows[0] });
});

export const getCampaign = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM campaigns WHERE campaign_id = $1', [req.params.campaignId]);
  if (result.rows.length === 0) throw new AppError('Campaign not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const getAllCampaigns = asyncHandler(async (req, res) => {
  const { status } = req.query;
  let queryText = 'SELECT * FROM campaigns';
  const params = [];

  if (status) {
    queryText += ' WHERE status = $1';
    params.push(status);
  }

  queryText += ' ORDER BY created_at DESC';

  const result = await query(queryText, params);
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export const updateCampaign = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const result = await query(
    'UPDATE campaigns SET status = $1, updated_at = NOW() WHERE campaign_id = $2 RETURNING *',
    [status, req.params.campaignId]
  );
  if (result.rows.length === 0) throw new AppError('Campaign not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const addVideoToCampaign = asyncHandler(async (req, res) => {
  const { videoUrl, title, thumbnailUrl, initialViews, initialLikes, initialComments, initialShares } = req.body;
  const { campaignId } = req.params;

  const videoId = uuidv4();
  const result = await query(
    `INSERT INTO videos (video_id, campaign_id, video_url, title, thumbnail_url,
      initial_views, initial_likes, initial_comments, initial_shares,
      current_views, current_likes, current_comments, current_shares)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $6, $7, $8, $9) RETURNING *`,
    [videoId, campaignId, videoUrl, title, thumbnailUrl,
      initialViews || 0, initialLikes || 0, initialComments || 0, initialShares || 0]
  );

  res.status(201).json({ success: true, data: result.rows[0] });
});

export const updateVideoMetrics = asyncHandler(async (req, res) => {
  const { views, likes, comments, shares } = req.body;
  const result = await query(
    `UPDATE videos
     SET current_views = $1, current_likes = $2, current_comments = $3, current_shares = $4,
         metrics_updated_at = NOW()
     WHERE video_id = $5 RETURNING *`,
    [views, likes, comments, shares, req.params.videoId]
  );
  if (result.rows.length === 0) throw new AppError('Video not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export default {
  createCampaign,
  getCampaign,
  getAllCampaigns,
  updateCampaign,
  addVideoToCampaign,
  updateVideoMetrics
};
