let express = require('express');
let cors = require('cors');
let app = express();
const cookieParser = require('cookie-parser')
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://fresh-basket-461dc.web.app'],
    credentials: true,
    optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
require('dotenv').config()
let jwt = require('jsonwebtoken');
app.use(cookieParser());
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
app.use(express.json());
let port = process.env.PORT || 8000;


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { error } = require('console');
const uri = `mongodb+srv://fresh-basket:${process.env.MONGODB_PASS}@cluster0.jt86e.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        let verifyToken = (req, res, next) => {

            const token = req.cookies?.token;
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decode) => {
                if (error) {
                    return res.status(401).send({ message: 'forbidden access' })
                }
                req.decoded = decode;
                next();
            })
        }

        let fruits = client.db('fresh-basket').collection('fruits');
        let carts = client.db('fresh-basket').collection('carts');
        let paymentCollection = client.db('fresh-basket').collection('payment');
        let userCollection = client.db('fresh-basket').collection('users');
        let blockedUserCollection = client.db('fresh-basket').collection('blockedUser');
        // Example with Express.js

        const checkBlockedUser = async (req, res, next) => {
            const email = req.decoded?.email;

            if (!email) return res.status(401).json({ message: "Invalid token" });
            const isBlocked = await userCollection.findOne({ email });
            if (isBlocked.blocked) {
                return res.status(403).json({ message: "User is blocked", forceLogout: true });
            }

            next();
        };

        const verifyAdmin = async (req, res, next) => {
            let email = req.decoded.email;
            let query = { email: email };
            let user = await userCollection.findOne(query);
            let isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();

        }

        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        app.post('/jwt', async (req, res) => {
            let user = req.body;
            console.log('Creating token for:', user);
            let token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '365d' });
            res
                .cookie('token', token, {
                    httpOnly: true,
                    secure: true,
                    sameSite: 'none'
                })
                .send({ success: true })
        })

        app.post('/create-payment-intent', async (req, res) => {
            let { price } = req.body;
            let amount = parseInt(price * 100);
            console.log(amount);
            let paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })


        app.get('/fruits', async (req, res) => {
            let category = req.query.category;
            let shipping = req.query.shipping;
            console.log(shipping)
            // console.log(category)
            let query = {};
            if (category && category !== 'null') query = { category };
            if (shipping && shipping !== 'null') query = { free_shipping: shipping === shipping };
            console.log(query)
            let result = await fruits.find(query).toArray();
            res.send(result)
        })

        app.delete('/fruits/:id', verifyToken, verifyAdmin, async (req, res) => {
            let id = req.params.id;
            console.log(id)
            let query = { _id: new ObjectId(id) };
            let result = await fruits.deleteOne(query);
            res.send(result);
        })

        app.get('/fruits/:id', async (req, res) => {
            let id = req.params.id;
            let query = { _id: new ObjectId(id) };
            let result = await fruits.findOne(query);
            res.send(result);
        })

        app.put('/fruits/:id', verifyToken, verifyAdmin, async (req, res) => {
            let user = req.body;
            let id = req.params.id;
            console.log(id, user)
            let query = { _id: new ObjectId(id) };
            let updateDoc = {
                $set: {
                    name: user.name,
                    price: user.price,
                    img: user.image,
                    description: user.details,
                    category: user.category
                }
            }
            let result = await fruits.updateOne(query, updateDoc);
            res.send(result);
        })


        app.post('/fruits', async (req, res) => {
            let user = req.body;
            let result = await fruits.insertOne(user);
            res.send(result);
        })

        app.get('/fruit', verifyToken, checkBlockedUser, async (req, res) => {
            let result = await fruits.find().toArray();
            res.send(result)
        })

        app.post('/cart', verifyToken, async (req, res) => {
            let fruit = req.body;
            let query = {};
            query.email = fruit.email;
            query.name = fruit.name;
            let isAlready = await carts.findOne(query)
            if (isAlready) {
                console.log(fruit.kg,isAlready.kg)
                let updateDoc = {
                    $set: {
                        kg: parseInt(fruit.kg) + parseInt(isAlready.kg)
                    }
                }
                let result = await carts.updateOne(isAlready, updateDoc);
                return res.send(result);
            }
            let result = await carts.insertOne(fruit);
            res.send(result);
        })

        app.get('/cart', verifyToken, checkBlockedUser, async (req, res) => {
            let email = req.query.email;
            console.log(email)
            let query = { email: email };
            let result = await carts.find(query).toArray();
            res.send(result);
        })

        app.delete('/cart/:id', async (req, res) => {
            let id = req.params.id;
            let query = { _id: new ObjectId(id) };
            let result = await carts.deleteOne(query);
            res.send(result);
        })

        app.post('/payments', async (req, res) => {
            let payment = req.body;
            let paymentResult = await paymentCollection.insertOne(payment);

            console.log(payment)

            const query = {
                _id: {
                    $in: payment.cardId.map(id => new ObjectId(id))
                }
            }

            const deleteResult = await carts.deleteMany(query);
            res.send({ paymentResult, deleteResult })
        })


        app.get('/categories', async (req, res) => {
            let categories = await fruits.aggregate([
                { $group: { _id: "$category" } },
                { $project: { _id: 0, category: "$_id" } },
                { $sort: { category: 1 } }
            ]).toArray();
            res.send(categories)
        })

        app.get('/payments/:email', verifyToken, async (req, res) => {
            const query = { email: req.params.email };
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const result = await paymentCollection.find(query).toArray();
            res.send(result)
        })


        app.post('/user', async (req, res) => {
            let users = req.body;
            let query = { email: users.email };
            let existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'existing user' })
            }
            let result = await userCollection.insertOne(users);
            res.send(result);
        })

        app.get('/user', async (req, res) => {
            let result = await userCollection.find().toArray();
            res.send(result);
        })




        app.get('/user/admin/:email', verifyToken, verifyAdmin, async (req, res) => {
            let email = req.params.email;
            if (email != req.decoded.email) {
                return res.send({ message: 'unauthorized access' });
            }
            let query = { email: email };
            let user = await userCollection.findOne(query);
            let admin = '';
            if (user) {
                admin = user?.role

            }

            res.send({ admin });
        })

        app.post('/blockedUser', verifyToken, verifyAdmin, async (req, res) => {
            let user = req.body;
            let result = await blockedUserCollection.insertOne(user);
            res.send(result);
        })

        app.get('/blockUser/:email', verifyToken, verifyAdmin, async (req, res) => {
            let email = req.params.email;
            console.log('this is', email)
            let query = { email: email };
            let findBlocked = await blockedUserCollection.findOne(query);
            res.send(findBlocked);
        })


        app.patch('/user/block/:email', verifyToken, verifyAdmin, async (req, res) => {
            let email = req.params.email;
            console.log(email)
            let filter = { email: email };
            let updateDoc = {
                $set: {
                    blocked: true
                }
            }

            let result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        })


        app.patch('/user/unblock/:email', verifyToken, verifyAdmin, async (req, res) => {
            let email = req.params.email;
            console.log(email)
            let filter = { email: email };
            let updateDoc = {
                $set: {
                    blocked: false
                }
            }

            let result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        })






        app.get('/blockedUser', verifyToken, verifyAdmin, async (req, res) => {
            let result = await blockedUserCollection.find().toArray();
            res.send(result);
        })


    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('ok ok just cools go to eat ')
})

app.listen(port, () => {
    console.log(`fresh basket  server running on port no ${port}`)
})