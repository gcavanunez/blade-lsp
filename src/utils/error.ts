import z from 'zod';

/**
 * Base class for creating typed, named errors with Zod schema validation.
 *
 * Usage:
 * ```ts
 * const MyError = NamedError.create("MyError", z.object({ field: z.string() }))
 * throw new MyError({ field: "value" })
 *
 * // Type guard
 * if (MyError.isInstance(e)) {
 *   console.log(e.data.field)
 * }
 *
 * // Serialize
 * const obj = error.toObject() // { name: "MyError", data: { field: "value" } }
 * ```
 */
export abstract class NamedError extends Error {
    abstract schema(): z.core.$ZodType;
    abstract toObject(): { name: string; data: unknown };

    /**
     * Create a new named error class with typed data.
     */
    static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
        const schema = z.object({
            name: z.literal(name),
            data,
        });

        const result = class extends NamedError {
            public static readonly Schema = schema;

            public override readonly name = name as Name;

            constructor(
                public readonly data: z.input<Data>,
                options?: ErrorOptions,
            ) {
                super(name, options);
                this.name = name;
            }

            static isInstance(input: unknown): input is InstanceType<typeof result> {
                return typeof input === 'object' && input !== null && 'name' in input && input.name === name;
            }

            schema() {
                return schema;
            }

            toObject() {
                return {
                    name: name,
                    data: this.data,
                };
            }
        };

        Object.defineProperty(result, 'name', { value: name });
        return result;
    }

    /**
     * Fallback error for unknown/unexpected errors.
     */
    public static readonly Unknown = NamedError.create(
        'UnknownError',
        z.object({
            message: z.string(),
        }),
    );

    /**
     * Wrap an unknown value into a NamedError.Unknown if it's not already a NamedError.
     */
    static wrap(error: unknown): NamedError {
        if (error instanceof NamedError) {
            return error;
        }
        if (error instanceof Error) {
            return new NamedError.Unknown({ message: error.message }, { cause: error });
        }
        return new NamedError.Unknown({ message: String(error) });
    }
}
