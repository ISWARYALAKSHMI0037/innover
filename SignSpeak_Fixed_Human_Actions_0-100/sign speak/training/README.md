# Train SignSpeak gesture models

This trains two separate static-hand classifiers from the linked datasets:

- HaGRID's 18 original gestures plus `no_gesture`
- RealSign's ISL fingerspelling letters A-Z

Both datasets are converted to wrist-relative 21-point hand landmarks. The
resulting small MLP models are exported as JSON for browser inference; no image
dataset is copied into the app. This recognizes static hand shapes, not
continuous or grammatical ISL.

## Prepare the datasets

Use Python 3.11, then install the training dependencies:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r training\requirements.txt
```

Download and extract the
[RealSign dataset](https://github.com/RealSign62/RealSign-Indian-Sign-Language-Dataset)
so it contains `Training (A-Z)`, `Validation (A-Z)`, and `Testing (A-Z)` folders.
The project keeps those existing train/validation/test splits.

For HaGRID, use its
[original 18-class release](https://github.com/hukenovs/hagrid/tree/Hagrid_v1).
Download and extract the `ann_train_val` annotations. The image archives are
not needed: this trainer uses HaGRID's hand landmark annotations directly and
does not download the 700+ GB image set. Its validation split is held out by
`user_id` to reduce signer leakage.

The first RealSign run downloads Google's MediaPipe hand-landmarker task file
to `~/.signspeak/hand_landmarker.task`. The dataset itself stays at the paths
you provide.

## Train and export

From the project root:

```powershell
python training\train.py `
  --realsign-dir "D:\datasets\RealSign\Dataset" `
  --hagrid-annotations "D:\datasets\HaGRID\ann_train_val"
```

To train only one model, use `--dataset isl --realsign-dir ...` or
`--dataset hagrid --hagrid-annotations ...`.

By default the trainer keeps at most 20,000 annotated hands per HaGRID class
using seeded reservoir sampling. To use every annotation, pass
`--max-samples-per-class 0`. Outputs are written to `public/models/`:

- `hagrid.json`
- `isl-alphabet.json`

Each model includes its class list, preprocessing parameters, learned weights,
and held-out metrics. Keep these generated files local; do not commit dataset
images or model artifacts unless you intend to distribute them.

## Use in SignSpeak

The generated model files are not included in the project. HaGRID and ISL
recognition will not start until their respective JSON model has been trained
and written to `public/models/`. If the app reports a missing model, run the
matching training command above and restart the Vite server.

After training, reload the Vite app and choose **HaGRID gestures** or
**ISL alphabet** in Recognition mode before starting the camera. If a model file
is missing or invalid, the app reports the problem rather than silently
switching to the prototype recognizer.

The datasets provide static images/landmarks. Validate camera performance with
new signers and realistic lighting before relying on predictions; training
accuracy is not a safety or language-translation guarantee.

Dataset references: [HaGRID](https://github.com/hukenovs/hagrid) and
[RealSign ISL](https://github.com/RealSign62/RealSign-Indian-Sign-Language-Dataset).
