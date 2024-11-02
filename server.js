const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Create connection to MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// Error handling middleware
const handleDatabaseError = (err, res) => {
    console.error('Database error:', err);
    res.status(500).json({
        error: 'Database error occurred',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
};

// Get all dining halls (unique list from dining_halls_times)
app.get('/dining-halls', (req, res) => {
    const query = `
        SELECT DISTINCT dining_hall 
        FROM menu_items
        ORDER BY dining_hall
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            handleDatabaseError(err, res);
            return;
        }
        res.json(results.map(row => ({ name: row.dining_hall })));
    });
});

// Get dining hall hours for a specific dining hall
app.get('/dining-halls/:name/hours', (req, res) => {
    const query = `
        SELECT 
            day,
            breakfast_open,
            breakfast_close,
            lunch_open,
            lunch_close,
            dinner_open,
            dinner_close
        FROM dining_halls_times
        WHERE dining_hall = ?
        ORDER BY CASE day
            WHEN 'Monday' THEN 1
            WHEN 'Tuesday' THEN 2
            WHEN 'Wednesday' THEN 3
            WHEN 'Thursday' THEN 4
            WHEN 'Friday' THEN 5
            WHEN 'Saturday' THEN 6
            WHEN 'Sunday' THEN 7
        END
    `;
    
    db.query(query, [req.params.name], (err, results) => {
        if (err) {
            handleDatabaseError(err, res);
            return;
        }
        
        const formattedResults = results.map(row => ({
            day: row.day,
            meals: {
                breakfast: row.breakfast_open ? {
                    open: row.breakfast_open,
                    close: row.breakfast_close
                } : null,
                lunch: row.lunch_open ? {
                    open: row.lunch_open,
                    close: row.lunch_close
                } : null,
                dinner: row.dinner_open ? {
                    open: row.dinner_open,
                    close: row.dinner_close
                } : null
            }
        }));
        
        res.json(formattedResults);
    });
});

app.get('/dining-halls/:name/menu', async (req, res) => {
    try {
        const { name } = req.params;
        const { date } = req.query;
        
        console.log('Menu request params:', { name, date });

        // First get exact dining hall name
        const nameQuery = `
            SELECT DISTINCT dining_hall 
            FROM menu_items 
            WHERE dining_hall LIKE ?
            LIMIT 1
        `;

        db.query(nameQuery, [`%${name}%`], (nameErr, nameResults) => {
            if (nameErr) {
                console.error('Name query error:', nameErr);
                handleDatabaseError(nameErr, res);
                return;
            }

            if (nameResults.length === 0) {
                console.log('No matching dining hall found for:', name);
                res.json({
                    error: 'Dining hall not found',
                    availableHalls: [] // Will be populated in production
                });
                return;
            }

            const exactName = nameResults[0].dining_hall;
            console.log('Matched dining hall name:', exactName);

            // Get menu items
            const query = `
                SELECT 
                    mi.food_id,
                    mi.food_name,
                    mi.meal,
                    mi.category,
                    mi.date,
                    f.*
                FROM menu_items mi
                LEFT JOIN foods f ON mi.food_id = f.food_id
                WHERE mi.dining_hall = ?
                AND DATE(mi.date) = ?
                ORDER BY 
                    CASE mi.meal
                        WHEN 'Breakfast' THEN 1
                        WHEN 'Lunch' THEN 2
                        WHEN 'Dinner' THEN 3
                        ELSE 4
                    END,
                    mi.category
            `;

            db.query(query, [exactName, date], (err, results) => {
                if (err) {
                    console.error('Menu query error:', err);
                    handleDatabaseError(err, res);
                    return;
                }

                console.log(`Found ${results.length} menu items for ${exactName}`);

                const menuByMeal = results.reduce((acc, item) => {
                    const meal = item.meal || 'Other';
                    const category = item.category || 'Uncategorized';

                    if (!acc[meal]) {
                        acc[meal] = {};
                    }
                    if (!acc[meal][category]) {
                        acc[meal][category] = [];
                    }

                    acc[meal][category].push({
                        id: item.food_id,
                        name: item.food_name,
                        category: item.category,
                        dietaryInfo: {
                            vegan: Boolean(item.is_vegan),
                            vegetarian: Boolean(item.is_vegetarian),
                            containsGluten: Boolean(item.has_gluten),
                            containsDairy: Boolean(item.has_dairy),
                            containsPeanuts: Boolean(item.has_peanut),
                            containsTreeNuts: Boolean(item.has_tree_nut),
                            containsShellfish: Boolean(item.has_shellfish)
                        }
                    });

                    return acc;
                }, {});

                res.json(menuByMeal);
            });
        });
    } catch (error) {
        console.error('Menu endpoint error:', error);
        res.status(500).json({ error: 'Failed to fetch menu' });
    }
});

// Get nutritional information for a specific food item
app.get('/menu-items/:foodId/nutrition', (req, res) => {
    const query = `
        SELECT *
        FROM foods
        WHERE food_id = ?
    `;
    
    db.query(query, [req.params.foodId], (err, results) => {
        if (err) {
            handleDatabaseError(err, res);
            return;
        }
        
        if (results.length === 0) {
            res.status(404).json({ error: 'Food item not found' });
            return;
        }
        
        const item = results[0];
        res.json({
            name: item.food_name,
            servingSize: item.serving_size,
            nutrients: {
                calories: item.calories,
                caloriesFromFat: item.calories_from_fat,
                totalFat: item.total_fat,
                totalFatPDV: item.total_fat_pdv,
                saturatedFat: item.saturated_fat,
                saturatedFatPDV: item.saturated_fat_pdv,
                transFat: item.trans_fat,
                cholesterol: item.cholesterol,
                cholesterolPDV: item.cholesterol_pdv,
                sodium: item.sodium,
                sodiumPDV: item.sodium_pdv,
                potassium: item.potassium,
                potassiumPDV: item.potassium_pdv,
                totalCarbohydrates: item.total_carbohydrates,
                totalCarbohydratesPDV: item.total_carbohydrates_pdv,
                dietaryFiber: item.dietary_fiber,
                dietaryFiberPDV: item.dietary_fiber_pdv,
                sugars: item.sugars,
                protein: item.protein,
                proteinPDV: item.protein_pdv
            },
            vitamins: {
                vitaminA: item.vitamin_a_pdv,
                vitaminC: item.vitamin_c_pdv,
                vitaminD: item.vitamin_d_pdv,
                calcium: item.calcium_pdv,
                iron: item.iron_pdv
            },
            allergens: {
                alcohol: item.has_alcohol,
                coconut: item.has_coconut,
                dairy: item.has_dairy,
                egg: item.has_egg,
                fish: item.has_fish,
                gluten: item.has_gluten,
                peanut: item.has_peanut,
                pork: item.has_pork,
                sesame: item.has_sesame,
                shellfish: item.has_shellfish,
                soy: item.has_soy,
                treeNut: item.has_tree_nut
            },
            certifications: {
                cageFree: item.is_cage_free_certified,
                organic: item.is_certified_organic,
                halal: item.is_halal,
                humanelyRaised: item.is_humanely_raised,
                kosher: item.is_kosher,
                local: item.is_local,
                vegan: item.is_vegan,
                vegetarian: item.is_vegetarian
            },
            ingredients: item.ingredients
        });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    db.query('SELECT 1', (err) => {
        if (err) {
            res.status(500).json({ status: 'error', message: 'Database connection failed' });
            return;
        }
        res.json({ status: 'healthy', message: 'Server is running and database is connected' });
    });
});

// Error handling for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing HTTP server and database connection...');
    db.end(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});