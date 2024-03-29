import { Router, Request, Response } from "express";
import { IUser, Users } from "../models/Users";
import { compare, hash } from "bcryptjs";
import { url } from "gravatar";
import fetch from "node-fetch";

// ENV
const DISCORD_GUILD = process.env.DISCORD_GUILD;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ROLE_MEMBER_PLUS = process.env.DISCORD_ROLE_MEMBER_PLUS;

// Utilities
import { generateString } from "../utilities/generateString";
import { getDocuments } from "../utilities/getDocuments";
import { generateApiToken as createToken } from "../utilities/generateApiToken";
import { signToken } from "../utilities/signToken";
import { verifyToken } from "../utilities/verifyToken";

export const routes = Router();

routes.get("/", async (req: Request, res: Response) => {
  const user = req.user;
  if (user) {
    res.render("account.ejs", {
      user,
      error: false,
      success: false,
      codeError: false,
      pfpError: false,
      documents: await getDocuments(user._id.toString(), 10),
    });
  }
});

// Retrieving User data
routes.post("/me", async (req: Request, res: Response) => {
  const password = req.body.password;
  const user = req.user;
  // TODO: Send an error message here
  if (!user || !(await compare(password, user.password)))
    return res.redirect("/account");

  res.setHeader("Content-Type", "text/plain");
  res.write(user.toString());
  res.end();
});

// Redeeming Plus code
routes.post("/redeem", async (req: Request, res: Response) => {
  const code = req.body.code;
  try {
    verifyToken(code); // Wont pass if its invalid
    const user = await Users.findOneAndUpdate(
      { _id: req.user?._id.toString() },
      { $set: { memberPlus: true } }
    );
    await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD}/members/${user?.discordId}/roles/${DISCORD_ROLE_MEMBER_PLUS}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        },
      }
    );
    res.render("success.ejs", { successMessage: "You are now Member+!" });
  } catch (error) {
    res.render("error.ejs", { error: "Member+ key is invalid!" });
  }
});

routes.post("/unlinkGithub", async (req: Request, res: Response) => {
  const _id = req.user?._id.toString();
  await Users.updateOne({ _id }, { $set: { githubAccess: null } });
  res.redirect("/account");
});

// Resetting password stuff
routes.post("/resetPasswordForm", async (req: Request, res: Response) => {
  const user = req.user;
  const oldPassword = req.body.oldPassword;
  const newPassword = req.body.newPassword;
  const confirmPassword = req.body.confirmPassword;

  try {
    if (!user) throw "No user!";
    if (!(await compare(oldPassword, user.password)))
      throw "Incorrect old password!";
    if (newPassword.length < 8)
      throw "Please make your new password more than 8 characters long!";
    if (newPassword !== confirmPassword) throw "New passwords do not match!";

    const hashedPass = await hash(newPassword, 13);
    await Users.updateOne(
      { _id: user._id },
      { $set: { password: hashedPass } }
    );
    res.render("account.ejs", {
      user,
      error: false,
      success: "Successfully reset your password!",
      codeError: false,
      pfpError: false,
      documents: await getDocuments(req.user?._id.toString(), 10),
    });
  } catch (error) {
    res.render("account.ejs", {
      user,
      error,
      success: false,
      codeError: false,
      pfpError: false,
      documents: await getDocuments(req.user?._id.toString(), 10),
    });
  }
});

routes.post("/changePfp", (req: Request, res: Response) => {
  const gitHubName = req.body.pfp;
  const user = req.user;
  const pfpUrl = `https://github.com/${gitHubName}.png`;
  if (!user) return;

  fetch(pfpUrl).then(async (data) => {
    try {
      if (data.status !== 200) throw "We could not find that Github user!";

      await Users.updateOne({ _id: user._id }, { $set: { icon: pfpUrl } });
      res.render("account.ejs", {
        user,
        error: false,
        success: false,
        codeError: false,
        pfpError: false,
        documents: await getDocuments(user._id.toString(), 10),
      });
    } catch (error) {
      res.render("account.ejs", {
        user,
        error,
        success: false,
        codeError: false,
        pfpError: false,
        documents: await getDocuments(user._id.toString(), 10),
      });
    }
  });
});

routes.post("/changeDocumentSettings", async (req: Request, res: Response) => {
  const settings = req.body;

  if (
    typeof settings.clipboard !== "boolean" ||
    typeof settings.longerUrls !== "boolean" ||
    typeof settings.instantDelete !== "boolean" ||
    typeof settings.encrypted !== "boolean" ||
    typeof settings.expiration !== "number" ||
    typeof settings.imageEmbed !== "boolean"
  )
    return res.json({
      success: false,
      message:
        "fuck you trying to give me something else other than booleans and numbers frfr",
    });

  const realSettings = {
    clipboard: settings.clipboard || false,
    longerUrls: settings.longerUrls || false,
    instantDelete: settings.instantDelete || false,
    encrypted: settings.encrypted || false,
    expiration: Math.abs(settings.expiration) || 5,
    imageEmbed: settings.imageEmbed || false,
  };

  await Users.updateOne(
    { _id: req.user?._id.toString() },
    { $set: { settings: realSettings } }
  );
});

routes.post("/changePfpGravatar", async (req: Request, res: Response) => {
  const gravatarEmail = req.body.pfp;
  const user = req.user;
  const _id = req.user?._id.toString();
  const gravatarUrl = await url(gravatarEmail);

  try {
    await Users.updateOne({ _id }, { $set: { icon: gravatarUrl } });
    res.redirect("/account");
  } catch (err) {
    res.render("account.ejs", {
      user,
      error: false,
      success: false,
      codeError: false,
      pfpError: "An error has occurred whilst trying to change your pfp!",
      documents: await getDocuments(_id, 10),
    });
  }
});

routes.post("/createInvite", async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return;

  if (user.codesLeft < 0)
    return res.render("account.ejs", {
      user,
      error: false,
      success: false,
      codeError: "You've exceeded your max invite count!",
      pfpError: false,
      documents: await getDocuments(req.user?._id.toString(), 10),
    });

  await Users.updateOne(
    { _id: user._id },
    {
      $set: { codesLeft: user.codesLeft - 1 },
      $push: { codes: generateString(8) },
    }
  );

  res.redirect("/account");
});

routes.get("/createPlusInvite", (req: Request, res: Response) => {
  if (req.user?.admin) {
    const code = signToken(generateString(33));
    res.render("success.ejs", { successMessage: `Plus code: ${code}` });
  } else {
    res.redirect("/");
  }
});

routes.post("/updateApiToken", async (req: Request, res: Response) => {
  await Users.updateOne(
    { _id: req.user?._id.toString() },
    { $set: { apiToken: createToken() } }
  );
  res.redirect("/account");
});
