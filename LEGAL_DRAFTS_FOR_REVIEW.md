# Legal drafts for review

Drafted 2026-10-02. **Not legal advice.** These describe what the code actually does today, but get a
solicitor to read them before they go live, especially the seller terms. `[Square brackets]` are facts only
you can fill in or decide.

---

## Part 1. Privacy Policy changes

### 1a. Add to §2 "Information we collect" (new bullet, after "Content you upload")

> **Artist application data.** If you apply to sell on Artifact Armoury, we collect what you put in the
> application: your store name, a description of yourself and your work, any website and social media links
> you choose to give, details of where else you sell, and the portfolio images you upload. We also keep our
> decision on your application and the reason we gave you.

### 1b. Add to §4 "How we use your information" (new paragraph at the end)

> **Artist applications.** We use application data to review your application, to decide whether to invite
> you to sell, to email you our decision and reasoning, and to send an invite code if you are approved. Our
> lawful basis is taking steps at your request before entering a contract with you. Our team reviews
> applications by hand. We do not use automated decision-making to accept or reject them.

### 1c. Add to §7 "Who we share it with" (new sentence at the end of the intro list, before "Artists otherwise…")

> Application details and portfolio images are visible only to our administrators, and are stored with the
> same hosting and file-storage providers listed above. We do not share them with other artists or buyers.

### 1d. Add to §9 "Retention" (new sentence)

> If your application is approved, we keep it for as long as your artist account exists. If it is
> unsuccessful, we keep it for [12 months] so we can respond to any follow-up and recognise repeat
> applications, then delete it, including the images you uploaded.

> **Decision for you:** 12 months is my suggestion, not something the code does. Nothing deletes old
> applications automatically yet, so if you publish a retention period, someone has to actually delete them
> (or I can build a scheduled clean-up).

### 1e. FIX an inaccurate sentence already in §9 "Retention"

The current text says:

> "When you delete a model listing, we also delete its associated fingerprint data, which allows that exact
> design to be uploaded again without being flagged as a duplicate."

**This is no longer true.** Since migration 061, deleting a listing is a soft delete: the row, its file hash
and its geometry fingerprint are kept on purpose, because they are the anti-theft corpus (dropping them would
let a stranger upload that exact file as their own). Replace it with:

> When an artist deletes a model listing, it is removed from the store but we keep its file hash and shape
> fingerprint, so the design stays protected against re-upload by someone else. The artist who uploaded it
> is never blocked from uploading their own file again.

Also bump the "Last updated" date on the Privacy Policy when you publish these.

---

## Part 2. Seller Terms (new page)

Suggested home: a new page at `/seller-terms`, linked from the redeem form and from Terms of Service §6.
Version string to record in `SELLER_TERMS_VERSION` (services/artistOnboarding.ts): the publish date.

> # Seller Terms
>
> *Last updated [date].* These terms apply to you if you sell on Artifact Armoury. They sit alongside our
> [Terms of Service](/terms-of-service) and [Privacy Policy](/privacy-policy). If they conflict, these Seller
> Terms win for anything to do with selling.
>
> ## 1. Who we are and what you are agreeing to
> Artifact Armoury (“we”, “us”) is operated by [Artifact Armoury Ltd, registered at Unit A, 82 James Carter
> Road, Mildenhall, IP28 7DE, company number [number]]. By redeeming an invite code and creating a seller
> account (“you”, “artist”), you agree to these terms. Selling is by invitation only, and an invite code is
> single use and cannot be transferred.
>
> ## 2. Your account
> You must be 18 or over. You must give accurate information, keep it up to date, and keep your login secure.
> Two-factor authentication is required before you can upload a model, publish a bundle or connect payouts.
> You are responsible for everything done through your account.
>
> ## 3. Your work and your rights
> You keep ownership of your designs and of the intellectual property in them. By listing a model you confirm
> that:
> - you created it, or you have the right to sell it, and it does not infringe anyone else’s intellectual
>   property, trademarks or licence terms (including games publishers’ rights);
> - if it uses licensed or third-party material, you have the right to sell it as a digital file on the terms
>   you set;
> - your listing, images and description accurately show what the buyer will receive.
>
> You grant us a non-exclusive, worldwide licence, for as long as the model is listed and for as long as
> buyers are entitled to download it, to host, process, convert, preview, watermark, display and deliver your
> files, and to use your store name, images and descriptions to promote the marketplace and your listings.
> You can ask us to stop using your images for promotion at any time, but we need to keep delivering files to
> people who have already bought them.
>
> ## 4. Listings and the licence buyers get
> You set your own prices (in pounds, before VAT) and choose the licence on each listing: personal use only,
> or commercial use (the buyer may sell physical prints they make themselves). Both licences forbid
> redistributing the digital files. A buyer buys each model once and may then print as many copies as the
> licence allows.
>
> ## 5. Fees and your share of each sale
> You keep [85%] of the **net price** of each sale (the listed price after any discount, before VAT), and we
> keep the rest. Your share is set per account and we will tell you if it changes for you. If we offer an
> introductory rate, we will tell you when it applies and when it ends. VAT is added on top for buyers. We
> collect it, and it does not come out of your share.
>
> **Discounts.** If you run a public sale, the discount is shared between you and us in proportion to our
> shares of the sale price. If you create a promo code, **the whole cost of the discount comes out of your
> share, not ours.** A discount can never take an item below the minimum price we set for it.
>
> ## 6. Getting paid
> Payouts are made through Stripe Connect, so you must complete Stripe’s verification to be paid. Earnings
> become eligible for payout after a holding period (currently [21] days), and we pay out once your eligible
> balance reaches the minimum (currently £[10]). Stripe may charge its own fees or hold funds under its own
> rules, and we are not responsible for Stripe’s decisions. You are responsible for your own tax, including
> declaring and paying tax on what you earn.
>
> ## 7. Refunds, disputes and removed sales
> If a buyer is refunded, the refunded amount comes out of your earnings for that sale. If that money has not
> been paid out to you yet, we simply do not pay it. [If it has already been paid out, we may deduct it from
> future payouts or ask you to repay it.] We may refund a buyer where a file is faulty, corrupt or not as
> described, or where a listing is removed for breaching these terms. We will tell you when we do.
>
> ## 8. Protection of your files
> We protect your files in the ways described on our [Creator Protection](/creator-protection) page:
> per-buyer watermarking of every download, shape fingerprinting of every upload, and previews that cannot be
> printed. These measures make theft traceable and hard. **They do not make it impossible, and we do not
> guarantee that your work will never be copied or shared.** If you find your work being shared, tell us and
> we will investigate, act on the account involved where we can trace it, and support your takedown request.
>
> ## 9. Duplicates and your own files
> We check every upload against the whole marketplace. A match against another artist’s work is rejected.
> You can upload your own file as many times as you like, for example to sell it on its own and inside a set.
> If you believe we have wrongly rejected a file, contact us and we will review it.
>
> ## 10. Deleting or unpublishing a listing
> You can unpublish or delete a listing at any time. Deleting removes it from the store, but **people who
> already bought it keep their access to download it.** We keep the file hash and shape fingerprint of
> deleted listings so the design stays protected.
>
> ## 11. Rules for sellers
> You must not: upload anything unlawful, infringing, hateful or misleading; copy another artist’s work;
> manipulate reviews, sales or analytics; try to take buyers off the platform to avoid our fee; share or
> resell files you have bought from others; or try to defeat our security, watermarking or fingerprinting.
> You must reply to buyer messages promptly and deal with problems fairly.
>
> ## 12. What we can do
> We may unpublish or remove any listing, refuse or reverse a sale, withhold payouts while we investigate,
> suspend or close an account, and report matters to the authorities, where we reasonably believe you have
> broken these terms, the law, or someone else’s rights. Where we reasonably can, we will tell you why.
>
> ## 13. Ending this agreement
> You can close your seller account at any time. Buyers keep their downloads. We will pay out any earnings
> you are owed, less anything we are entitled to keep under these terms. We can end your access with notice,
> or immediately for serious breach.
>
> ## 14. Liability
> We provide the marketplace “as is”. We do not guarantee any level of sales. Nothing in these terms limits
> liability that cannot lawfully be limited, including for death or personal injury caused by negligence, or
> for fraud. Subject to that, our total liability to you is limited to [the amount of earnings we owe you
> in the 12 months before the claim].
>
> ## 15. Changes and contact
> We may update these terms. If we make a material change we will tell you through the site or by email, and
> you will be asked to accept the new version before you carry on selling. These terms are governed by the
> laws of [England and Wales], and the courts of [England and Wales] have jurisdiction. Questions:
> support@artifactarmoury.com.

---

## Part 3. Things I found that need a decision

1. **The seller terms link on the redeem form is broken.** `RedeemArtistInvite.tsx` links to `/terms`, and
   there is no such route. The only terms page is `/terms-of-service`. Today an artist "agrees to the seller
   terms" without any seller terms existing, other than §6 of the general Terms.
2. **§5 of the draft above discloses that promo codes cost the artist, not us.** That is how the code works
   (decided in the promo-code build). It should be said plainly to artists before they accept.
3. **§7 has a square-bracketed sentence about clawing back already-paid money.** The code reverses unpaid
   earnings but does not claw back money already paid, and only reports it to the admin. Keep or cut that
   sentence depending on whether you want the right, because once it's in the terms you can use it.
4. **Placeholders:** company number, the 85% share (kept consistent with the About page and application page),
   hold days, minimum payout, liability cap, governing law, and the 12-month application retention.
5. **If you adopt these,** also bump `SELLER_TERMS_VERSION`, and remember the existing artists accepted the
   old (non-existent) version, so you may want to ask them to accept the new one.
