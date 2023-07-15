# Pimlico Tutorials

This repository contains the full code for [Pimlico tutorials](https://docs.pimlico.io/tutorial) in the Pimlico documentation.

To set up the repository, clone it, copy the .env.example file to .env and fill in your Pimlico API key (use the [quick start guide](https://docs.pimlico.io/how-to/quick-start) to generate one), install the dependencies, and run `npm run tutorial-1`!

If you are looking to run the tutorial code for [tutorial 2](https://docs.pimlico.io/tutorial/tutorial-2), in addition to filling the Pimlico API key, you will also need to generate a private key and replace the `privateKey` variable at the start of `tutorial-2.ts` with it before running `npm run tutorial-2`.

```bash
npm install
cp .env.example .env
# fill in your Pimlico API key in .env
npm run tutorial-1
```

If everything works correctly, you should deploy a User Operation as per the flow of the tutorial.

Good luck!
