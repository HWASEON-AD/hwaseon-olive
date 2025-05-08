import { pool } from '../../db';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { category, startDate, endDate } = req.query;

    if (!category || !startDate || !endDate) {
        return res.status(400).json({ message: 'Missing required parameters' });
    }

    try {
        // 해당 날짜 범위의 가장 최근 크롤링 시간 조회
        const [latestCrawl] = await pool.query(
            'SELECT MAX(crawled_at) as latest_crawl FROM rankings WHERE date BETWEEN ? AND ?',
            [startDate, endDate]
        );

        // 해당 날짜 범위의 랭킹 데이터 조회
        const [rows] = await pool.query(
            `SELECT 
                date,
                category,
                rank,
                brand,
                product,
                originalPrice,
                salePrice,
                event,
                crawled_at,
                DATE_FORMAT(crawled_at, '%H:%i') as crawled_at_formatted
            FROM rankings 
            WHERE category = ? 
            AND date BETWEEN ? AND ?
            ORDER BY date DESC, rank ASC`,
            [category, startDate, endDate]
        );

        return res.status(200).json({
            rankings: rows,
            latestCrawl: latestCrawl[0].latest_crawl
        });
    } catch (error) {
        console.error('Error fetching rankings:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
} 