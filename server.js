import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import Stripe from "stripe";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const ai = process.env.AI_API_KEY
  ? new OpenAI({ apiKey: process.env.AI_API_KEY })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// Stripe webhook MUST receive the raw body.
app.post("/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send("Stripe is not configured");
    }
    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );

      // TODO: persist subscription/customer status in your database.
      switch (event.type) {
        case "checkout.session.completed":
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          console.log("Stripe event:", event.type);
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error(err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

app.use(express.json());
app.use(express.static("public"));

app.post("/api/analyse-enquiry", async (req, res) => {
  const { enquiry } = req.body || {};
  if (!enquiry || enquiry.length > 10000) {
    return res.status(400).json({ error: "Please provide a valid enquiry." });
  }
  if (!ai) {
    return res.status(503).json({ error: "AI is not configured. Add AI_API_KEY to .env." });
  }

  try {
    const response = await ai.responses.create({
      model: process.env.AI_MODEL || "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content:
            "You are a quotation assistant for UK trades businesses. Extract only useful information from a customer enquiry. Clearly distinguish explicit facts, estimates and unknowns. Never claim an estimate is guaranteed. Return concise structured JSON."
        },
        {
          role: "user",
          content: `Analyse this customer enquiry and return JSON with keys: customer_name, job_type, tasks, materials, measurements, estimated_labour_hours, missing_information, questions_to_ask, notes. Enquiry:\n${enquiry}`
        }
      ]
    });

    res.json({ result: response.output_text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI analysis failed." });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe is not configured." });

  const { plan, customerEmail } = req.body || {};
  const prices = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    business: process.env.STRIPE_PRICE_BUSINESS
  };

  if (!prices[plan]) return res.status(400).json({ error: "Invalid plan." });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: customerEmail || undefined,
      line_items: [{ price: prices[plan], quantity: 1 }],
      success_url: `${process.env.APP_URL}/?checkout=success`,
      cancel_url: `${process.env.APP_URL}/?checkout=cancelled`,
      allow_promotion_codes: true
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create checkout session." });
  }
});

app.get("/api/health", (_req,res) =>
  res.json({ ok:true, aiConfigured:!!ai, stripeConfigured:!!stripe })
);

app.listen(port, () => console.log(`QuoteForge running on ${process.env.APP_URL || `http://localhost:${port}`}`));
