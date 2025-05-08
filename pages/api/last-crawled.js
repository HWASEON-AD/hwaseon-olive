import { pool } from '../../db';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const [rows] = await pool.query(
            'SELECT crawled_at FROM rankings ORDER BY crawled_at DESC LIMIT 1'
        );

        if (rows.length === 0) {
            return res.status(200).json({ lastCrawled: null });
        }

        return res.status(200).json({ lastCrawled: rows[0].crawled_at });
    } catch (error) {
        console.error('Error fetching last crawled time:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
} 