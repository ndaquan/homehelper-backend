const { executeQuery, executeNonQuery } = require("../config/database");
const {
  taskPhotosUpload,
  memoryUpload,
  cloudinary,
} = require("../config/cloudinary");

// Helper to find or create a session row by bookingId + dayKey
async function findOrCreateSession(bookingId, dayKey) {
  // Only create/find session rows for multi-day (weekly/monthly) bookings.
  const bookingRes = await executeQuery(
    `SELECT unit, start_time, end_time FROM Bookings WHERE booking_id = @bookingId`,
    { bookingId }
  );
  const booking = bookingRes.recordset && bookingRes.recordset[0];
  // If booking not found, proceed to attempt select (will return nothing)
  const isMulti = (() => {
    try {
      if (!booking) return false;
      const unit = String(booking.unit || "").toLowerCase();
      if (
        unit.includes("tuần") ||
        unit.includes("tháng") ||
        unit.includes("week") ||
        unit.includes("month")
      )
        return true;
      const s = booking.start_time ? new Date(booking.start_time) : null;
      const e = booking.end_time ? new Date(booking.end_time) : null;
      if (s && e) {
        const dayMs = 24 * 60 * 60 * 1000;
        return e.getTime() - s.getTime() >= dayMs;
      }
      return false;
    } catch (e) {
      return false;
    }
  })();

  if (!isMulti) {
    // For single-day bookings, we do not persist sessions.
    return null;
  }

  const selectSql = `SELECT * FROM Sessions WHERE booking_id = @bookingId AND day_key = @dayKey`;
  const res = await executeQuery(selectSql, { bookingId, dayKey });
  const rows = res.recordset || [];
  if (rows.length) return rows[0];

  const insertSql = `INSERT INTO Sessions (booking_id, day_key, created_at, updated_at) VALUES (@bookingId, @dayKey, GETDATE(), GETDATE()); SELECT SCOPE_IDENTITY() as id;`;
  const insertRes = await executeQuery(insertSql, { bookingId, dayKey });
  const id =
    insertRes &&
    insertRes.recordset &&
    insertRes.recordset[0] &&
    insertRes.recordset[0].id;
  if (!id) throw new Error("Failed to create session");
  const created = await executeQuery(selectSql, { bookingId, dayKey });
  return created.recordset[0];
}

// POST /api/bookings/:bookingId/sessions/:dayKey/photos
// Accepts multipart/form-data files as 'photos' and body.type = before|after
async function uploadSessionPhotos(req, res) {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const dayKey = req.params.dayKey;
    const type = (req.body.type || "before").toLowerCase();
    if (!bookingId || !dayKey)
      return res
        .status(400)
        .json({ success: false, message: "Missing bookingId or dayKey" });
    if (!req.files || req.files.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No files uploaded" });

    // find or create session (may return null for non-multi-day bookings)
    const session = await findOrCreateSession(bookingId, dayKey);
    const persistToDb = Boolean(session);

    const uploaded = [];

    if (taskPhotosUpload) {
      // multer-storage-cloudinary already stored files and set file.path
      for (const [idx, file] of req.files.entries()) {
        const photoUrl = file.path;
        if (persistToDb) {
          await executeQuery(
            `INSERT INTO SessionPhotos (session_id, booking_id, [type], photo_url, storage_path, file_name, mime, size, ordinal, uploaded_by, uploaded_at, created_at, updated_at)
             VALUES (@sessionId, @bookingId, @type, @photoUrl, @storagePath, @fileName, @mime, @size, @ordinal, @uploadedBy, GETDATE(), GETDATE(), GETDATE())`,
            {
              sessionId: session.session_id,
              bookingId,
              type,
              photoUrl,
              storagePath: file.path || null,
              fileName: file.originalname || null,
              mime: file.mimetype || null,
              size: file.size || null,
              ordinal: idx,
              uploadedBy: req.user && (req.user.userId || req.user.user_id),
            }
          );
        }
        uploaded.push(photoUrl);
      }
    } else {
      // Fallback: upload via cloudinary upload_stream
      const userId =
        (req.user && (req.user.userId || req.user.user_id)) || "anonymous";
      const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
      const folder = `${folderBase}/sessions/${bookingId}/${dayKey}`;

      for (const [idx, file] of req.files.entries()) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: "image" },
            (err, info) => {
              if (err) return reject(err);
              resolve(info);
            }
          );
          stream.end(file.buffer);
        });

        const photoUrl = result.secure_url || result.url;
        if (persistToDb) {
          await executeQuery(
            `INSERT INTO SessionPhotos (session_id, booking_id, [type], photo_url, storage_path, file_name, mime, size, ordinal, uploaded_by, uploaded_at, created_at, updated_at)
             VALUES (@sessionId, @bookingId, @type, @photoUrl, @storagePath, @fileName, @mime, @size, @ordinal, @uploadedBy, GETDATE(), GETDATE(), GETDATE())`,
            {
              sessionId: session.session_id,
              bookingId,
              type,
              photoUrl,
              storagePath: result.public_id || null,
              fileName: file.originalname || null,
              mime: file.mimetype || null,
              size: file.size || null,
              ordinal: idx,
              uploadedBy: req.user && (req.user.userId || req.user.user_id),
            }
          );
        }
        uploaded.push(photoUrl);
      }
    }

    return res.json({ success: true, files: uploaded, persisted: persistToDb });
  } catch (err) {
    console.error("Session photo upload error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Upload failed", error: err.message });
  }
}

// GET /api/bookings/:bookingId/sessions/:dayKey
async function getSession(req, res) {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const dayKey = req.params.dayKey;
    if (!bookingId || !dayKey)
      return res
        .status(400)
        .json({ success: false, message: "Missing bookingId or dayKey" });

    const sessionRes = await executeQuery(
      `SELECT * FROM Sessions WHERE booking_id = @bookingId AND day_key = @dayKey`,
      { bookingId, dayKey }
    );
    const session = sessionRes.recordset && sessionRes.recordset[0];
    if (!session)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });

    const photosRes = await executeQuery(
      `SELECT * FROM SessionPhotos WHERE session_id = @sessionId ORDER BY ordinal ASC, uploaded_at ASC`,
      { sessionId: session.session_id }
    );
    const photos = photosRes.recordset || [];
    const grouped = { before: [], after: [] };
    for (const p of photos) {
      if ((p.type || "").toLowerCase() === "after") grouped.after.push(p);
      else grouped.before.push(p);
    }

    return res.json({ success: true, session, photos: grouped });
  } catch (err) {
    console.error("getSession error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load session",
      error: err.message,
    });
  }
}

// PATCH /api/bookings/:bookingId/sessions/:dayKey
// body: { done: true, finalizeTasks: boolean }
async function updateSession(req, res) {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const dayKey = req.params.dayKey;
    const { done, finalizeTasks } = req.body || {};
    if (!bookingId || !dayKey)
      return res
        .status(400)
        .json({ success: false, message: "Missing bookingId or dayKey" });

    const sessionRes = await executeQuery(
      `SELECT * FROM Sessions WHERE booking_id = @bookingId AND day_key = @dayKey`,
      { bookingId, dayKey }
    );
    const session = sessionRes.recordset && sessionRes.recordset[0];
    if (!session)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });

    if (done) {
      const now = new Date();
      // compute accumulated (if started_at present)
      let add = 0;
      if (session.started_at) {
        add = Math.max(0, new Date() - new Date(session.started_at));
      }
      const newAccum = (session.accumulated_ms || 0) + add;
      await executeQuery(
        `UPDATE Sessions SET done = 1, finished_at = GETDATE(), started_at = NULL, accumulated_ms = @acc WHERE session_id = @sessionId`,
        { acc: newAccum, sessionId: session.session_id }
      );

      // Optionally mark in-progress tasks to completed in TaskPhotos/Tasks if desired
      if (finalizeTasks) {
        // This app uses different checklist storage; leave hook for backend to finalize session tasks if needed
      }

      return res.json({
        success: true,
        session_id: session.session_id,
        accumulated_ms: newAccum,
      });
    }

    // Allow unmarking done (resume)
    await executeQuery(
      `UPDATE Sessions SET done = 0, started_at = GETDATE(), finished_at = NULL WHERE session_id = @sessionId`,
      { sessionId: session.session_id }
    );
    return res.json({ success: true, session_id: session.session_id });
  } catch (err) {
    console.error("updateSession error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update session",
      error: err.message,
    });
  }
}

module.exports = {
  uploadSessionPhotos,
  getSession,
  updateSession,
  findOrCreateSession,
};
