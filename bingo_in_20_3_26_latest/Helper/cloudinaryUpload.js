const cloudinary = require('../Config/Cloudinary');

/**
 * Upload a file to Cloudinary from an express-fileupload file object.
 * @param {Object} fileObject - express-fileupload file (has .data Buffer and .name)
 * @param {string} folder - Cloudinary folder name (default: 'bingo')
 * @returns {Promise<{url: string, publicId: string}>}
 */
async function uploadToCloudinary(fileObject, folder = 'bingo') {
    const re = /(?:\.([^.]+))?$/;
    const ext = re.exec(fileObject.name)[1];
    const publicId = Date.now().toString();
    const base64 = fileObject.data.toString('base64');
    const dataUri = `data:image/${ext};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
        folder: folder,
        public_id: publicId,
    });

    return { url: result.secure_url, publicId: result.public_id };
}

/**
 * Resolve an image URL — handles both legacy filenames and full Cloudinary URLs.
 * @param {string} photo - filename or full URL from the database
 * @param {string} baseUrl - optional base URL prefix for legacy paths
 * @returns {string}
 */
function resolveImageUrl(photo, baseUrl = '') {
    if (!photo) return '';
    if (photo.startsWith('http://') || photo.startsWith('https://')) return photo;
    return `${baseUrl}profile/bingo/${photo}`;
}

module.exports = { uploadToCloudinary, resolveImageUrl };
