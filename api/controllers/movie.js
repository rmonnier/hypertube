import fs from 'fs';
const bluebird = require('bluebird');
const crypto = bluebird.promisifyAll(require('crypto'));
const nodemailer = require('nodemailer');
const User = require('../models/User');
/**
 * GET /me
 * Profile page.
 */
exports.Stream = (req, res) => {
  const path = 'assets/sample.mp4'
  const stat = fs.statSync(path)
  const fileSize = stat.size
  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1]
      ? parseInt(parts[1], 10)
      : fileSize-1
    const chunksize = (end-start)+1
    const file = fs.createReadStream(path, {start, end})
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    }
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    }
    res.writeHead(200, head)
    fs.createReadStream(path).pipe(res)
  }
};

/**
 * GET /islogged
 */
exports.getIslogged = (req, res) => {
  if (req.isAuthenticated()) {
    return res.send({ error: '' });
  }
  res.send({ error: 'You are not logged.' });
};

/**
 * POST /me
 * Update profile information.
 */
exports.postUpdateProfile = (req, res, next) => {
  const { id } = req.body;
  switch (id) {

    case 'name-form': {
      req.assert('firstName', 'First name can\'t be more than 20 letters long').len({ max: 20 });
      req.assert('lastName', 'Last name can\'t be more than 20 letters long').len({ max: 20 });

      const error = req.validationErrors();

      if (error) {
        return res.send({ error });
      }

      User.findById(req.user.id, (err, user) => {
        if (err) { return next(err); }
        if (req.body.firstName.length !== 0) {
          user.profile.firstName = req.body.firstName;
        }
        if (req.body.lastName.length !== 0) {
          user.profile.lastName = req.body.lastName;
        }
        user.save((err) => {
          if (err) { return next(err); }
          user.password = '';
          return res.send({ error: '', user });
        });
      });
      break;
    }

    case 'email-form': {
      req.assert('email', 'Please enter a valid email address.').isEmail();
      req.assert('password', 'Password cannot be blank').notEmpty();
      req.sanitize('email').normalizeEmail({ gmail_remove_dots: false });

      const error = req.validationErrors();

      if (error) {
        return res.send({ error });
      }

      User.findById(req.user.id, (err, user) => {
        if (err) { return next(err); }
        user.comparePassword(req.body.password, (err, isMatch) => {
          if (err) { return next(err); }
          if (isMatch === false) {
            return res.send({ error: [{ param: 'password', msg: 'Incorrect password.', value: req.body.password }] });
          }
          user.email = req.body.email;
          user.save((err) => {
            if (err) {
              if (err.code === 11000) {
                return res.send({ error: [{ param: 'email', msg: 'The email address you have entered is already associated with an account.', value: req.body.email }] });
              }
              return next(err);
            }
            user.password = '';
            return res.send({ error: '', user });
          });
        });
      });
      break;
    }

    case 'password-form': {
      req.assert('password', 'Password must be at least 4 characters long').len(4);
      req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password);

      const error = req.validationErrors();

      if (error) {
        return res.send({ error });
      }

      User.findById(req.user.id, (err, user) => {
        if (err) { return next(err); }
        user.password = req.body.password;
        user.save((err) => {
          if (err) { return next(err); }
          return res.send({ error: '', user });
        });
      });
      break;
    }
    default:
      res.status(401).send({ error: 'invalid action requested' });
  }
};

/**
 * GET /profile/:login
 * Profile page.
 */
exports.getAccount = (req, res, next) => {
  User.findById(req.user.id, (err, user) => {
    if (err) { return next(err); }
    user.password = '';
    return res.send({ error: '', user });
  });
};

/**
 * POST /account/password
 * Update current password.
 */
// exports.postUpdatePassword = (req, res, next) => {
//   req.assert('password', 'Password must be at least 4 characters long').len(4);
//   req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password);
//
//   const error = req.validationErrors();
//
//   if (error) {
//     return res.send({ error });
//   }
//
//   User.findById(req.user.id, (err, user) => {
//     if (err) { return next(err); }
//     user.password = req.body.password;
//     user.save((err) => {
//       if (err) { return next(err); }
//       return res.send({ error: '' })
//     });
//   });
// };

/**
 * DELETE /me
 * Delete user account.
 */
exports.deleteDeleteAccount = (req, res, next) => {
  User.remove({ _id: req.user.id }, (err) => {
    if (err) { return next(err); }
    req.logout();
    res.send({ error: '' });
  });
};

/**
 * GET /logout
 * Log out.
 */
exports.signout = (req, res) => {
  req.logout();
  res.send({ error: '' });
};

/**
 * GET /account/unlink/:provider
 * Unlink OAuth provider.
 */
exports.getOauthUnlink = (req, res, next) => {
  const provider = req.params.provider;
  User.findById(req.user.id, (err, user) => {
    if (err) { return next(err); }
    user[provider] = undefined;
    user.tokens = user.tokens.filter(token => token.kind !== provider);
    user.save((err) => {
      if (err) { return next(err); }
        return res.send({ error: '' })
    });
  });
};

/**
 * POST /reset/:token
 * Process the reset password request.
 */
exports.postReset = (req, res, next) => {
  req.assert('password', 'Password must be at least 4 characters long.').len(4);
  req.assert('confirm', 'Passwords must match.').equals(req.body.password);

  const error = req.validationErrors();

  if (error) {
    return res.send({ error });
  }

  const resetPassword = () =>
    User
      .findOne({ passwordResetToken: req.params.token })
      .where('passwordResetExpires').gt(Date.now())
      .then((user) => {
        if (!user) {
          return res.send({ error: 'Password reset token is invalid or has expired.' });
        }
        user.password = req.body.password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        return user.save().then(() => new Promise((resolve, reject) => {
          req.logIn(user, (err) => {
            if (err) { return reject(err); }
            resolve(user);
          });
        }));
      });

  const sendResetPasswordEmail = (user) => {
    if (!user) { return; }
    const transporter = nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: process.env.SENDGRID_USER,
        pass: process.env.SENDGRID_PASSWORD
      }
    });
    const mailOptions = {
      to: user.email,
      from: 'hackathon@starter.com',
      subject: 'Your Hackathon Starter password has been changed',
      text: `Hello,\n\nThis is a confirmation that the password for your account ${user.email} has just been changed.\n`
    };
    return transporter.sendMail(mailOptions)
      .then(() => {
        return res.send({ error: '' })
      });
  };

  resetPassword()
    .then(sendResetPasswordEmail)
    .then(() => { if (!res.finished) res.redirect('/'); })
    .catch(err => next(err));
};

/**
 * POST /forgot
 * Create a random token, then the send user an email with a reset link.
 */
exports.postForgot = (req, res, next) => {
  req.assert('email', 'Please enter a valid email address.').isEmail();
  req.sanitize('email').normalizeEmail({ gmail_remove_dots: false });

  const error = req.validationErrors();

  if (error) {
    return res.send({ error });
  }

  const createRandomToken = crypto
    .randomBytesAsync(16)
    .then(buf => buf.toString('hex'));

  const setRandomToken = token =>
    User
      .findOne({ email: req.body.email })
      .then((user) => {
        if (!user) {
          return res.send({ error: 'Account with that email address does not exist.' });
        } else {
          user.passwordResetToken = token;
          user.passwordResetExpires = Date.now() + 3600000; // 1 hour
          user = user.save();
        }
        return user;
      });

  const sendForgotPasswordEmail = (user) => {
    if (!user) { return; }
    const token = user.passwordResetToken;
    const transporter = nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: process.env.SENDGRID_USER,
        pass: process.env.SENDGRID_PASSWORD
      }
    });
    const mailOptions = {
      to: user.email,
      from: 'hackathon@starter.com',
      subject: 'Reset your password on Hackathon Starter',
      text: `You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n
        Please click on the following link, or paste this into your browser to complete the process:\n\n
        http://${req.headers.host}/reset/${token}\n\n
        If you did not request this, please ignore this email and your password will remain unchanged.\n`
    };
    return transporter.sendMail(mailOptions)
      .then(() => {
        return({ error: '' })
      });
  };

  createRandomToken
    .then(setRandomToken)
    .then(sendForgotPasswordEmail)
    .catch(next);
};