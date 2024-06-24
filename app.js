// Increase the default max listeners for EventEmitter
const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 20;

// Require necessary modules
const express = require('express');
const ejsmate = require('ejs-mate');
const app = express();
const multer = require('multer');
const { storage } = require('./cloudConfig.js');
const upload = multer({ storage });
const methodOverride = require('method-override');
const path = require("path");
const mongoose = require('mongoose');
const Listing = require("./models/listing.js");
const Reviews = require("./models/review.js");
const session = require('express-session');
const MongoStore = require('connect-mongo');  // express sessions
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user.js");
const db=process.env.ATLASDB_URL;
// Configure app settings
app.engine('ejs', ejsmate);
app.set('view engine', 'ejs');
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Middleware for method override and session
app.use(methodOverride('_method'));

// MongoStore
const store=MongoStore.create({
  mongoUrl:db,
crypto:{
  secret:"process.env.SECRET"
},
touchAfter:24*3600
});

const sessionOptions = {
  store,
  secret: "process.env.SECRET",
  resave: false,
  saveUninitialized: true,
};

app.use(session(sessionOptions));
app.use(flash());

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Middleware to set local variables
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.user;
  next();
});

// Connect to MongoDB
const port = 3000;
async function main() {
  await mongoose.connect(db);
}
main().catch(err => console.log(err));

// Middleware to check authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash("error", "You must be logged in to access this page");
  res.redirect("/login");
}

// Middleware to check listing ownership
async function checkListingOwnership(req, res, next) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    req.flash("error", "Invalid listing ID");
    return res.redirect("/listings");
  }
  try {
    const listing = await Listing.findById(id);
    if (!listing) {
      req.flash("error", "Listing not found");
      return res.redirect("/listings");
    }
    if (listing.owner.equals(req.user._id)) {
      return next();
    }
    req.flash("error", "You do not have permission to do that");
    res.redirect(`/listings/${id}`);
  } catch (err) {
    console.error("Error finding listing:", err);
    req.flash("error", "An error occurred while checking listing ownership");
    res.redirect("/listings");
  }
}

// Middleware to check review ownership
async function checkReviewOwnership(req, res, next) {
  const { reviewId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    req.flash("error", "Invalid review ID");
    return res.redirect("/listings");
  }
  try {
    const review = await Reviews.findById(reviewId);
    if (!review) {
      req.flash("error", "Review not found");
      return res.redirect("back");
    }
    if (review.author.equals(req.user._id)) {
      return next();
    }
    req.flash("error", "You do not have permission to do that");
    res.redirect("back");
  } catch (err) {
    console.error("Error finding review:", err);
    req.flash("error", "An error occurred while checking review ownership");
    res.redirect("/listings");
  }
}

// Routes
app.get('/signup', (req, res) => {
  res.render('./user/signup.ejs');
});

app.get('/login', (req, res) => {
  res.render('./user/login.ejs');
});

app.get('/listings', async (req, res) => {
  try {
    const alllistings = await Listing.find({});
    res.render("index.ejs", { alllistings, title: 'All Listings' });
  } catch (err) {
    console.error('Error fetching listings:', err);
    req.flash("error", "An error occurred while fetching listings");
    res.redirect("/"); // Redirect to a generic error page or home page
  }
});

app.get("/listings/new", ensureAuthenticated, (req, res) => {
  res.render("new", { title: 'New Listing' });
});

app.post("/listings", ensureAuthenticated, upload.single('listing[image]'), async (req, res) => {
  let url = req.file.path;
  let file = req.file.filename;
  const newListing = new Listing(req.body.listing);
  newListing.owner = req.user._id;
  newListing.image = { url, file };
  try {
    await newListing.save();
    req.flash("success", "New listing is created");
    res.redirect("/listings");
  } catch (err) {
    console.error('Error saving listing:', err);
    req.flash("error", "An error occurred while creating a new listing");
    res.redirect("/listings");
  }
});

app.post("/signup", async (req, res) => {
  let { username, password, email } = req.body;
  const newUser = new User({ username, email });
  try {
    const registeredUser = await User.register(newUser, password);
    req.login(registeredUser, err => {
      if (err) {
        req.flash("error", err.message);
        return res.redirect("/signup");
      }
      req.flash("success", "You are signed in");
      res.redirect("/listings");
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/signup");
  }
});

app.post("/login", passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }), async (req, res) => {
  req.flash("success", "You are signed in");
  res.redirect("/listings");
});

app.get("/logout", (req, res) => {
  req.logout(err => {
    if (err) {
      console.error("Error logging out:", err);
      return next(err);
    }
    req.flash("success", "Logout successful. See you next time!");
    res.redirect("/listings");
  });
});

app.get("/listings/:id/edit", ensureAuthenticated, checkListingOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash("error", "Invalid listing ID");
      return res.redirect("/listings");
    }
    const listing = await Listing.findById(id);
    if (!listing) {
      req.flash("error", "Listing not found");
      return res.redirect("/listings");
    }
    res.render("edit.ejs", { listing, title: 'Edit Listing' });
  } catch (err) {
    console.error("Error finding listing:", err);
    req.flash("error", "An error occurred while fetching the listing for editing");
    res.redirect("/listings");
  }
});

app.put("/listings/:id", ensureAuthenticated, upload.single('listing[image]'), checkListingOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash("error", "Invalid listing ID");
      return res.redirect("/listings");
    }
    const listing = await Listing.findById(id);
    if (!listing) {
      req.flash("error", "Listing not found");
      return res.redirect("/listings");
    }

    // Update the listing details
    listing.title = req.body.listing.title;
    listing.description = req.body.listing.description;
    listing.price = req.body.listing.price;

    // Check if a new image is uploaded
    if (req.file) {
      listing.image.url = req.file.path;
      listing.image.file = req.file.filename;
    }

    await listing.save();
    req.flash("success", "Listing updated successfully");
    res.redirect(`/listings/${id}`);
  } catch (err) {
    console.error("Error updating listing:", err);
    req.flash("error", "An error occurred while updating the listing");
    res.redirect(`/listings/${id}/edit`);
  }
});

app.delete("/listings/:id", ensureAuthenticated, checkListingOwnership, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    req.flash("error", "Invalid listing ID");
    return res.redirect("/listings");
  }
  try {
    await Listing.findByIdAndDelete(id);
    req.flash("success", "Listing deleted successfully");
    res.redirect("/listings");
  } catch (err) {
    console.error("Error deleting listing:", err);
    req.flash("error", "An error occurred while deleting the listing");
    res.redirect("/listings");
  }
});

app.get("/listings/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    req.flash("error", "Invalid listing ID");
    return res.redirect("/listings");
  }
  try {
    const listingid = await Listing.findById(id).populate({
      path: "reviews",
      populate: { path: "author" }
    }).populate('owner');
    if (!listingid) {
      req.flash("error", "Listing not found");
      return res.redirect("/listings");
    }
    res.render("show.ejs", { listingid, title: 'Listing Details' });
  } catch (err) {
    console.error("Error finding listing:", err);
    req.flash("error", "An error occurred while fetching the listing details");
    res.redirect("/listings");
  }
});

app.post("/listings/:id/reviews", ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    req.flash("error", "Invalid listing ID");
    return res.redirect("/listings");
  }
  try {
    const listing = await Listing.findById(id);
    if (!listing) {
      req.flash("error", "Listing not found");
      return res.redirect("/listings");
    }
    const newreview = new Reviews(req.body.review);
    newreview.author = req.user._id;
    listing.reviews.push(newreview);
    await newreview.save();
    await listing.save();
    req.flash("success", "Review added successfully");
    res.redirect(`/listings/${id}`);
  } catch (err) {
    console.error("Error adding review:", err);
    req.flash("error", "An error occurred while adding the review");
    res.redirect("/listings");
  }
});

app.delete("/listings/:id/reviews/:reviewId", ensureAuthenticated, checkReviewOwnership, async (req, res) => {
  const { id, reviewId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(reviewId)) {
    req.flash("error", "Invalid IDs");
    return res.redirect("/listings");
  }
  try {
    await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
    await Reviews.findByIdAndDelete(reviewId);
    req.flash("success", "Review deleted successfully");
    res.redirect(`/listings/${id}`);
  } catch (err) {
    console.error("Error deleting review:", err);
    req.flash("error", "An error occurred while deleting the review");
    res.redirect("/listings");
  }
});

// Route for the About page
app.get('/search', async (req, res) => {
  const { country } = req.query;
  if (!country) {
    req.flash("error", "Please enter a country to search");
    return res.redirect("/listings");
  }
  try {
    const listings = await Listing.find({ country: new RegExp(country, 'i') });
    req.flash("success", "Search Successful");
    res.render("index.ejs", { alllistings: listings, title: 'Search Results' });
  } catch (err) {
    console.error('Error searching listings:', err);
    req.flash("error", "An error occurred while searching for listings");
    res.redirect("/listings");
  }
});

// Start server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
