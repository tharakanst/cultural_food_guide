# Project plan

**Project title:** Cultural Food Guide

**Group members:**
- Nuwan Tharaka, Deegoda Gamage
- Ryan Pang Zhen Tan
- Yeo You Ming
- Timothy Jeremy Tay

## Project overview

Cultural Food Guide is a web app that lets users point their webcam camera (as a
prototype) at a menu, food packaging label, or product/dishes, and instantly
receive an explanation of what it is, its ingredients and the associated dietary
restrictions, and its cultural significance. Behind the scenes, the app uses OCR
to extract text from the image and an LLM to interpret the ingredients, translate
and simplify unfamiliar terms, and add local cultural context (e.g. "this is a
Finnish rye bread, typically eaten with butter and cold cuts").

This solution targets many who are unfamiliar with local food in Finland: food
labels and menus in a foreign country are often untranslatable in a meaningful
sense - a literal translation doesn't tell you if something is safe to eat, what
it actually tastes like, or how it's normally served. Existing translation apps
convert words but not meaning nor visual representation. This matters for dietary
safety (allergies, religious or ethical restrictions), for reducing food waste
from bad guesses, and for helping newcomers engage with local food culture with
confidence instead of anxiety.

## Goals and objectives

- Accurately identify the dishes from the photos
- Provide accurate ingredients and recipes
- Provide locally relevant cultural context and history (e.g. origin, how it's
  traditionally eaten/served, and any relevant etiquette)
- Highlight information relevant to allergies, dietary, religious or ethical
  restrictions
- Provide a reference image of the dish sourced from the web (not AI-generated),
  to avoid inaccurate or misleading AI-generated visuals

## Key features

- Camera / Image upload to get the image of the food
- AI-powered food identification
  - Sends an AI a prompt of the food and requests information related to it
- Food information and explanation
  - Provides a simple description of the identified food, including ingredients,
    recipe, and what the food is generally like
  - Provides a visual representation of how the food should look like
- Cultural and historical context
  - Provides the user with information of the food's country of origin, its
    cultural significance, traditions, and common ways to enjoy the food
- Dietary and allergen awareness
  - Highlights potential allergens or dietary concerns based on the ingredient
    information, such as vegetarian or vegan restrictions, while reminding the
    user that AI-generated information should not replace the official food
    labels or professional advice

## Use of AI

- OCR and LLM to analyze images of menus, food labels and products/dishes
  - OCR to extract visible text
  - LLM to interpret texts and images to identify the food, explain unfamiliar
    ingredients and terminology, translate any relevant information, and provide
    cultural context specific to the local country

## Accessibility, ethics, and responsible AI

- **Accessibility:** text to speech for recipe steps, readable formatting, alt
  text for images
- **Ethics:** risk of misidentifying dishes or misattributing cultural origins
- **Responsibility:** transparent AI output, verify reliable sources of
  information, show uncertainty where appropriate, and encourage users to verify
  critical allergy/dietary information
- **Privacy:** only the captured image is sent for AI processing — no location,
  personal identifiers, or other user data is collected or stored, minimizing
  privacy risk for users

## Expected deliverable

A web app prototype that takes in an image and outputs text and images.

## Learning goals

- Gain practical experience in integrating AI technologies such as image
  recognition, OCR, and large language models
- Understand how AI can be used to interpret food-related information and provide
  cultural context
- Explore responsible AI considerations such as accuracy, bias, accessibility,
  and the risk of providing incorrect information
- Improve our skills in collaborative software development, prototyping, testing,
  and presenting an AI-based solution within a limited time frame
