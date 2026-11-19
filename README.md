# GearHive Server

Express and MongoDB server for JontroLagbe, an equipment rental marketplace.

## Purpose
Handles equipment, bookings, favorites, Stripe payment verification,
role based access (customer, owner, admin) and dashboard analytics.

## Live URL
link will be here...

## Key Features
- Session token verification with verifyToken, verifyRenter, verifyOwner and verifyAdmin
- Equipment CRUD with admin approval
- Server side search, filter, sort and pagination
- Booking with date based availability check and server side price calculation
- Stripe payment verification and payment records
- Admin and owner analytics
- Cron job to complete finished rentals and email notifications

## npm Packages
express, cors, dotenv, mongodb, stripe, node-cron, nodemailer

## Environment Variables
See .env.example