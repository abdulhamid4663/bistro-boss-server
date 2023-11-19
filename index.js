const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xgaxesu.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Verify token whether the user has valid token or not
const verifyToken = (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unAuthorized access', status: 401 });
    }

    const token = req?.headers?.authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'unAuthorized access', status: 401 });
        }

        req.decoded = decoded;
        next()
    })
};

async function run() {
    try {
        await client.connect();

        const cartCollection = client.db('bistroDB').collection('carts');
        const userCollection = client.db('bistroDB').collection('users');
        const menuCollection = client.db('bistroDB').collection('menus');
        const paymentCollection = client.db('bistroDB').collection('payments');

        // verify whether a user is admin or not
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === "admin";
            if (!isAdmin) {
                return res.status(403).send({ message: 'Forbidden access', status: 403 })
            }

            next()
        }

        // create a token and sign in jwt 
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
            res.send({ token });
        })

        // Menus related apis
        app.get('/menus', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        })

        app.get('/menus/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result);
        })

        app.post("/menus", verifyToken, verifyAdmin, async (req, res) => {
            const menu = req.body;
            const result = await menuCollection.insertOne(menu);
            res.send(result);
        })

        app.patch('/menus/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const menu = req.body;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    name: menu.name,
                    category: menu.category,
                    price: menu.price,
                    recipe: menu.recipe,
                    image: menu.image
                }
            };

            const result = await menuCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        app.delete("/menus/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })

        // Users related apis
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'Forbidden access', status: 403 });
            }

            const query = { email: email }
            const user = await userCollection.findOne(query);

            let admin = false
            if (user) {
                admin = user?.role === "admin";
            };

            res.send({ admin })
        })

        app.post('/users', async (req, res) => {
            const user = req.body;

            const query = { email: user.email };
            const userExisting = await userCollection.findOne(query);

            if (userExisting) {
                return res.send({ message: "users is exist already", insertedId: null })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };

            const result = await userCollection.updateOne(filter, updateDoc)
            res.send(result);
        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        // Cart related apis
        app.get('/carts', async (req, res) => {
            let query = {}
            if (req.query.email) {
                query.email = req.query.email
            }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/carts', async (req, res) => {
            const food = req.body;
            const result = await cartCollection.insertOne(food);
            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        })

        // payment intent api
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: [
                    'card'
                ]
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post('/payments', async (req, res) => {
            const paymentInfo = req.body;
            const paymentInfoResult = await paymentCollection.insertOne(paymentInfo);

            const query = {_id: {
                $in: paymentInfo.cartIds.map(id => new ObjectId(id))
            }};

            const deleteResult = await cartCollection.deleteMany(query);

            res.send({paymentInfoResult, deleteResult});
        })


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Bistro Boss Server is Running.');
});

app.listen(port, () => {
    console.log(`Bistro boss server is running on port: ${port}`)
})
